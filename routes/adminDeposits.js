const { formatMoney } = require('../services/moneyFormat');
const router = require('express').Router();
const Deposit = require('../models/Deposit');
const { getAllDeposits } = require('../services/depositService');
const { saveDeposit } = require('../services/memberService');
const {
  getActiveMonthTarget,
  yearMonthFromDate,
  getMemberArrearsSummary,
  listCashierDepositEligibleMembers,
} = require('../services/monthlyTargetService');
const {
  previewSmartMemberPayment,
  applySmartMemberPayment,
} = require('../services/smartRepaymentService');
const { sendDepositReceipt, generateReceiptPdf } = require('../services/notificationService');
const { paymentChannelLabel } = require('../services/paymentChannelService');
const {
  validateManualDepositInput,
  resolveDepositIdempotencyKey,
} = require('../services/depositValidation');
const {
  beginDepositIdempotency,
  completeDepositIdempotency,
  failDepositIdempotency,
} = require('../services/depositIdempotencyService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const { clientIp } = require('../services/securityService');
const { isReceiptDuplicateError, isDuplicateKeyError } = require('../services/receiptService');

router.use(requireAuth);

function depositWriteErrorPayload(error, fallback = 'Unable to record deposit.') {
  if (isReceiptDuplicateError(error)) {
    return {
      status: 409,
      error: 'Receipt number conflict while recording the deposit. Please try again — a new receipt will be assigned.',
      code: 'RECEIPT_DUPLICATE',
    };
  }
  if (isDuplicateKeyError(error)) {
    return {
      status: 409,
      error: 'A conflicting deposit record was detected. Please try again.',
      code: 'DUPLICATE_KEY',
    };
  }
  return {
    status: error.status || 500,
    error: error.message || fallback,
    partialDeposit: error.partialDeposit || undefined,
  };
}

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

/** Members with unpaid dues and insufficient Advance Balance (excludes paid / advance-covered). */
router.get('/eligible-members', recordDeposits, requireCashierRole, async (req, res) => {
  try {
    const payload = await listCashierDepositEligibleMembers({
      asOfDate: new Date(),
    });
    return res.json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load deposit-eligible members.',
    });
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

router.get('/member-arrears/:memberId', recordDeposits, requireCashierRole, async (req, res) => {
  try {
    const arrears = await getMemberArrearsSummary(req.params.memberId, {
      asOfDate: new Date(),
    });
    return res.json({ arrears });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load member deposit arrears.',
    });
  }
});

async function withDepositIdempotency(req, validated, work) {
  const claim = await beginDepositIdempotency(resolveDepositIdempotencyKey(req), {
    actorId: req.session?.user?.id || req.session?.user?._id || '',
    memberId: validated.memberId,
    amount: validated.amount,
  });
  if (claim.kind === 'replay') {
    return { replay: true, status: claim.status, body: claim.body };
  }

  try {
    const body = await work();
    await completeDepositIdempotency(claim.key, 201, body);
    return { replay: false, status: 201, body, key: claim.key };
  } catch (error) {
    await failDepositIdempotency(claim.key);
    throw error;
  }
}

router.post('/smart-payment', recordDeposits, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const validated = validateManualDepositInput(req.body);
    const yearMonth = req.body?.yearMonth || yearMonthFromDate();
    const notes = req.body?.notes || '';

    const outcome = await withDepositIdempotency(req, validated, async () => {
      const result = await applySmartMemberPayment({
        memberId: validated.memberId,
        amount: validated.amount,
        yearMonth,
        notes,
        recordedBy: req.session?.user?.name || 'Cashier',
        paymentMethod: validated.paymentMethod,
        paymentReference: validated.paymentReference,
        actor: req.session?.user || null,
        ip: clientIp(req),
      });

      let message = result.message || 'Smart payment recorded.';
      if (result.bookBalance != null) {
        message += ` Bank book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
      }

      return {
        ...result,
        smartPayment: true,
        message,
        idempotentReplay: false,
      };
    });

    if (outcome.replay) {
      return res.status(outcome.status).json({ ...outcome.body, idempotentReplay: true });
    }
    return res.status(201).json(outcome.body);
  } catch (error) {
    const payload = depositWriteErrorPayload(error, 'Unable to record smart payment.');
    return res.status(payload.status).json(payload);
  }
});

router.post('/', recordDeposits, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const validated = validateManualDepositInput(req.body);
    const {
      yearMonth,
      notes,
      smartSplit,
    } = req.body;
    const useSmartSplit = smartSplit !== false;
    const applyMonth = yearMonth || yearMonthFromDate();

    const outcome = await withDepositIdempotency(req, validated, async () => {
      if (useSmartSplit) {
        const result = await applySmartMemberPayment({
          memberId: validated.memberId,
          amount: validated.amount,
          yearMonth: applyMonth,
          notes: notes || '',
          recordedBy: req.session?.user?.name || 'Cashier',
          paymentMethod: validated.paymentMethod,
          paymentReference: validated.paymentReference,
          actor: req.session?.user || null,
          ip: clientIp(req),
        });
        let message = result.message || 'Smart payment recorded.';
        if (result.bookBalance != null) {
          message += ` Bank book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
        }
        const monthlyDeposit = result.monthlyResult?.regularDeposit
          || result.monthlyResult?.deposit
          || null;
        const advanceDeposit = result.advanceResult?.deposit
          || result.monthlyResult?.advanceDeposit
          || null;
        return {
          ...result,
          smartPayment: true,
          message,
          receiptUrl: monthlyDeposit?._id ? `/api/admin/deposits/${monthlyDeposit._id}/receipt` : null,
          advanceReceiptUrl: advanceDeposit?._id ? `/api/admin/deposits/${advanceDeposit._id}/receipt` : null,
          receiptNumber: monthlyDeposit?.receiptNumber || advanceDeposit?.receiptNumber || null,
          idempotentReplay: false,
        };
      }

      const target = await getActiveMonthTarget();

      const result = await saveDeposit(validated.memberId, validated.amount, {
        yearMonth: applyMonth,
        notes: notes || '',
        recordedBy: req.session?.user?.name || 'Cashier',
        paymentMethod: validated.paymentMethod,
        paymentReference: validated.paymentReference,
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

      return {
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
        idempotentReplay: false,
      };
    });

    if (outcome.replay) {
      return res.status(outcome.status).json({ ...outcome.body, idempotentReplay: true });
    }
    return res.status(201).json(outcome.body);
  } catch (error) {
    const payload = depositWriteErrorPayload(error, 'Unable to record deposit.');
    return res.status(payload.status).json(payload);
  }
});

module.exports = router;
