const router = require('express').Router();
const {
  saveAdvanceDeposit,
  listInternalBorrowings,
  createInternalBorrowing,
  settleInternalBorrowing,
  repayUnpaidContribution,
  listUnpaidContributions,
  listMemberAdvanceBalances,
} = require('../services/advanceBorrowingService');
const {
  completeMemberBuyIn,
  listPendingBuyInMembers,
  getEntryValuation,
  replaceMember,
} = require('../services/memberMigrationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits', 'can_manage_refunds'));

router.get('/advances', async (req, res) => {
  try {
    const members = await listMemberAdvanceBalances();
    return res.json({ members });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load advance balances.' });
  }
});

router.post('/advances', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await saveAdvanceDeposit(req.body?.memberId, req.body?.amount, {
      notes: req.body?.notes || '',
      recordedBy: req.session?.user?.name || 'Cashier',
    });
    return res.status(201).json({
      ...result,
      receiptUrl: result.deposit?._id ? `/api/admin/deposits/${result.deposit._id}/receipt` : null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record advance deposit.' });
  }
});

router.get('/borrowings', async (req, res) => {
  try {
    let status = req.query.status;
    if (status === 'open') status = undefined; // list open + partial via service default below
    const borrowings = await listInternalBorrowings({
      status: req.query.status === 'open' ? undefined : status,
      memberId: req.query.memberId,
      openOnly: req.query.status === 'open' || !req.query.status,
    });
    return res.json({ borrowings });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load borrowings.' });
  }
});

router.post('/borrowings', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await createInternalBorrowing({
      investmentId: req.body?.investmentId,
      borrowerId: req.body?.borrowerId,
      lenderId: req.body?.lenderId,
      amount: req.body?.amount,
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to create internal borrowing.' });
  }
});

router.post('/borrowings/:id/repay', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await settleInternalBorrowing(req.params.id, {
      amount: req.body?.amount,
      recordedBy: req.session?.user?.name || 'Cashier',
      notes: req.body?.notes || '',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to settle borrowing.' });
  }
});

router.get('/unpaid-contributions', async (req, res) => {
  try {
    const contributions = await listUnpaidContributions({
      investmentId: req.query.investmentId,
    });
    return res.json({ contributions });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load unpaid contributions.' });
  }
});

router.post('/unpaid-contributions/:id/repay', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await repayUnpaidContribution(req.params.id, {
      amount: req.body?.amount,
      recordedBy: req.session?.user?.name || 'Cashier',
      notes: req.body?.notes || '',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record contribution repayment.' });
  }
});

router.get('/pending-buyins', async (req, res) => {
  try {
    const [members, valuation] = await Promise.all([
      listPendingBuyInMembers(),
      getEntryValuation(),
    ]);
    return res.json({ members, valuation });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load pending buy-ins.' });
  }
});

router.post('/member-buyin', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await completeMemberBuyIn({
      memberId: req.body?.memberId,
      amountPaid: req.body?.amountPaid ?? req.body?.amount,
      notes: req.body?.notes || '',
      recordedBy: req.session?.user?.name || 'Cashier',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to complete buy-in.' });
  }
});

router.post('/member-replace', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await replaceMember({
      departingMemberId: req.body?.departingMemberId,
      newMemberId: req.body?.newMemberId,
      entryAmountPaid: req.body?.entryAmountPaid,
      notes: req.body?.notes || '',
      recordedBy: req.session?.user?.name || 'Cashier',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to settle member replacement.' });
  }
});

module.exports = router;
