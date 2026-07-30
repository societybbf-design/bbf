const { formatMoney } = require('../services/moneyFormat');
const router = require('express').Router();
const Deposit = require('../models/Deposit');
const { getAllDeposits } = require('../services/depositService');
const { saveDeposit } = require('../services/memberService');
const { getActiveMonthTarget, yearMonthFromDate } = require('../services/monthlyTargetService');
const {
  previewSmartMemberPayment,
  applySmartMemberPayment,
} = require('../services/smartRepaymentService');
const { sendDepositReceipt, generateReceiptPdf } = require('../services/notificationService');
const { paymentChannelLabel } = require('../services/paymentChannelService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const { clientIp } = require('../services/securityService');

router.use(requireAuth);

function requireCashierRole(req, res, next) {
  if (req.session?.user?.role === 'cashier') {
    return next();
  }
  return res.status(403).json({
    error: 'Only the Cashier can record member deposits.',
  });
}

/** Read history/receipts: Cashier or report viewers (CEO oversight). */
const viewDeposits = requirePermission('can_manage_deposits', 'can_view_reports');
/** Create deposits: Cashier-only permission + hard role check. */
const recordDeposits = requirePermission('can_manage_deposits');

router.get('/', viewDeposits, async (req, res) => {
  try {
    const deposits = await getAllDeposits();
    res.json({ deposits });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load deposit history.' });
  }
});

router.get('/:id/receipt', viewDeposits, async (req, res) => {
  try {
    const { id } = req.params;
    const deposit = await Deposit.findById(id).populate({ path: 'member', select: 'name email' });
    if (!deposit) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }

    const pdfBuffer = await generateReceiptPdf(
      deposit.member,
      deposit,
      req.session.user.name || 'Admin'
    );
    const receiptName = deposit.receiptNumber || deposit._id;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receiptName}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate receipt.' });
  }
});

router.get('/smart-payment/preview', recordDeposits, requireCashierRole, async (req, res) => {
  try {
    const { memberId, amount, yearMonth } = req.query;
    if (!memberId || !amount) {
      return res.status(400).json({ error: 'memberId and amount are required.' });
    }
    const preview = await previewSmartMemberPayment({
      memberId,
      amount: Number(amount),
      yearMonth: yearMonth || yearMonthFromDate(),
    });
    return res.json(preview);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to preview smart payment.' });
  }
});

router.post('/smart-payment', recordDeposits, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const { memberId, amount, yearMonth, notes, paymentMethod, paymentReference } = req.body;
    if (!memberId || amount == null) {
      return res.status(400).json({ error: 'Member and amount are required.' });
    }
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be a positive number.' });
    }

    const result = await applySmartMemberPayment({
      memberId,
      amount: numericAmount,
      yearMonth: yearMonth || yearMonthFromDate(),
      notes: notes || '',
      recordedBy: req.session?.user?.name || 'Cashier',
      paymentMethod,
      paymentReference,
      actor: req.session?.user || null,
      ip: clientIp(req),
    });

    let message = result.message || 'Smart payment recorded.';
    if (result.bookBalance != null) {
      message += ` Bank book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
    }

    return res.status(201).json({
      ...result,
      smartPayment: true,
      message,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to record smart payment.',
    });
  }
});

router.post('/', recordDeposits, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const {
      memberId,
      amount,
      yearMonth,
      notes,
      paymentMethod,
      paymentReference,
      smartSplit,
    } = req.body;
    if (!memberId || typeof amount === 'undefined' || amount === null) {
      return res.status(400).json({ error: 'Member and amount are required.' });
    }

    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be a positive number.' });
    }

    const useSmartSplit = smartSplit !== false;
    const applyMonth = yearMonth || yearMonthFromDate();

    if (useSmartSplit) {
      const result = await applySmartMemberPayment({
        memberId,
        amount: numericAmount,
        yearMonth: applyMonth,
        notes: notes || '',
        recordedBy: req.session?.user?.name || 'Cashier',
        paymentMethod,
        paymentReference,
        actor: req.session?.user || null,
        ip: clientIp(req),
      });
      let message = result.message || 'Smart payment recorded.';
      if (result.bookBalance != null) {
        message += ` Bank book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
      }
      return res.status(201).json({
        ...result,
        smartPayment: true,
        message,
      });
    }

    const target = await getActiveMonthTarget();

    const result = await saveDeposit(memberId, numericAmount, {
      yearMonth: applyMonth,
      notes: notes || '',
      recordedBy: req.session?.user?.name || 'Cashier',
      paymentMethod,
      paymentReference,
      actor: req.session?.user || null,
      ip: clientIp(req),
    });

    let emailSent = false;
    try {
      const emailResult = await sendDepositReceipt(
        result.member,
        result.deposit,
        req.session.user.name || 'Cashier'
      );
      emailSent = Boolean(emailResult?.sent);
    } catch (error) {
      console.error('Deposit receipt email failed:', error.message);
    }

    let message = 'Deposit recorded.';
    if (result.monthlySplit?.splitApplied) {
      const s = result.monthlySplit;
      const bits = [];
      if (Number(s.towardTarget) > 0) {
        bits.push(`Fixed deposit ${formatMoney(Number(s.towardTarget), 2)} toward ${s.yearMonth} target`);
      }
      if (Number(s.surplus) > 0) {
        bits.push(`surplus ${formatMoney(Number(s.surplus), 2)} → advance (balance now ${formatMoney(Number(result.member?.advanceBalance || 0), 2)})`);
      }
      if (Number(s.remainingUnpaid) > 0) {
        bits.push(`still due ${formatMoney(Number(s.remainingUnpaid), 2)}`);
      }
      if (!bits.length) {
        bits.push(`Toward ${s.yearMonth} target: ${formatMoney(Number(s.towardTarget), 2)}`);
      }
      message = bits.join(' · ');
    }
    if (result.bookBalance != null) {
      message += ` Bank book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
    }
    if (emailSent) {
      message += ' Receipt emailed to the member.';
    }

    const regularId = result.regularDeposit?._id || (result.deposit?.type === 'regular' ? result.deposit._id : null);
    const advanceId = result.advanceDeposit?._id || null;

    return res.status(201).json({
      ...result,
      message,
      emailSent,
      paymentChannelLabel: paymentChannelLabel(result.deposit?.paymentMethod),
      monthTarget: target,
      receiptNumber: result.deposit?.receiptNumber || null,
      receiptUrl: regularId || result.deposit?._id
        ? `/api/admin/deposits/${regularId || result.deposit._id}/receipt`
        : null,
      advanceReceiptUrl: advanceId ? `/api/admin/deposits/${advanceId}/receipt` : null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to record deposit.',
    });
  }
});

module.exports = router;
