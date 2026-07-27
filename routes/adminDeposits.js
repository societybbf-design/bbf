const router = require('express').Router();
const Deposit = require('../models/Deposit');
const { getAllDeposits } = require('../services/depositService');
const { saveDeposit } = require('../services/memberService');
const { getActiveMonthTarget, yearMonthFromDate } = require('../services/monthlyTargetService');
const { sendDepositReceipt, generateReceiptPdf } = require('../services/notificationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits'));

router.get('/', async (req, res) => {
  try {
    const deposits = await getAllDeposits();
    res.json({ deposits });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load deposit history.' });
  }
});

router.get('/:id/receipt', async (req, res) => {
  try {
    const { id } = req.params;
    const deposit = await Deposit.findById(id).populate({ path: 'member', select: 'name email' });
    if (!deposit) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }

    const pdfBuffer = await generateReceiptPdf(deposit.member, deposit, req.session.user.name || 'Admin');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="deposit-${deposit._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate receipt.' });
  }
});

router.post('/', requirePasswordConfirmation, async (req, res) => {
  try {
    const { memberId, amount, yearMonth, notes } = req.body;
    if (!memberId || typeof amount === 'undefined' || amount === null) {
      return res.status(400).json({ error: 'Member and amount are required.' });
    }

    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be a positive number.' });
    }

    const target = await getActiveMonthTarget();
    const applyMonth = yearMonth || yearMonthFromDate();

    const result = await saveDeposit(memberId, numericAmount, {
      yearMonth: applyMonth,
      notes: notes || '',
      recordedBy: req.session?.user?.name || 'Admin',
    });

    void sendDepositReceipt(result.member, result.deposit, req.session.user.name || 'Admin').catch((error) => {
      console.error('Deposit receipt email failed:', error.message);
    });

    let message = 'Deposit recorded.';
    if (result.monthlySplit?.splitApplied) {
      const s = result.monthlySplit;
      const bits = [`Toward ${s.yearMonth} target: $${Number(s.towardTarget).toFixed(2)}`];
      if (s.surplus > 0) bits.push(`surplus $${Number(s.surplus).toFixed(2)} → advance`);
      if (s.remainingUnpaid > 0) bits.push(`still due $${Number(s.remainingUnpaid).toFixed(2)}`);
      message = bits.join(' · ');
    }
    if (result.bookBalance != null) {
      message += ` · Bank book balance now $${Number(result.bookBalance).toFixed(2)}`;
    }
    if (result.ledgerWarning) {
      message += ` · Ledger warning: ${result.ledgerWarning}`;
    }

    return res.status(201).json({
      deposit: result.deposit,
      advanceDeposit: result.advanceDeposit,
      member: result.member,
      monthlySplit: result.monthlySplit,
      bankLedger: result.bankLedger,
      bookBalance: result.bookBalance,
      ledgerWarning: result.ledgerWarning || null,
      activeMonthTarget: target,
      message,
      emailSent: false,
      receiptUrl: result.deposit?._id ? `/api/admin/deposits/${result.deposit._id}/receipt` : null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save admin deposit.' });
  }
});

module.exports = router;
