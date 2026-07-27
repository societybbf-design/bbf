const router = require('express').Router();
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const {
  previewMemberExit,
  initiateMemberExit,
  listOpenExitRequests,
  listCashierExitQueue,
  getExitRequestById,
  cancelMemberExit,
  completeCashierMemberExit,
} = require('../services/memberExitService');

router.use(requireAuth);

const ceoInitiate = requirePermission('can_manage_members');
const cashierPay = requirePermission('can_manage_deposits');

function requireCashierRole(req, res, next) {
  if (req.session?.user?.role === 'cashier') {
    return next();
  }
  return res.status(403).json({
    error: 'Only the Cashier can process member-exit disbursement.',
  });
}

/** CEO (and members managers): preview + initiate + track open exits. No payout. */
router.get('/preview', ceoInitiate, async (req, res) => {
  try {
    const preview = await previewMemberExit(req.query.memberId);
    return res.json({ preview });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to preview member exit.' });
  }
});

router.get('/', ceoInitiate, async (req, res) => {
  try {
    const exits = await listOpenExitRequests();
    return res.json({ exits });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load exit requests.' });
  }
});

router.get('/cashier-queue', cashierPay, requireCashierRole, async (req, res) => {
  try {
    const queue = await listCashierExitQueue();
    return res.json({ queue });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load exit payout queue.' });
  }
});

router.get('/:id', ceoInitiate, async (req, res) => {
  try {
    const exitRequest = await getExitRequestById(req.params.id);
    return res.json({ exitRequest });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load exit request.' });
  }
});

router.post('/', ceoInitiate, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await initiateMemberExit({
      memberId: req.body?.memberId || req.body?.departingMemberId,
      notes: req.body?.notes,
      confirmSettlementAmount: req.body?.confirmSettlementAmount ?? req.body?.settlementAmount,
      initiatedBy: req.session?.user?.name || 'CEO',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to initiate member exit.' });
  }
});

router.post('/:id/cancel', ceoInitiate, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await cancelMemberExit(req.params.id, {
      cancelledBy: req.session?.user?.name || 'CEO',
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to cancel exit request.' });
  }
});

/** Cashier-only payout — CEO cannot disburse even with full-access permissions. */
router.post('/:id/cashier-complete', cashierPay, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await completeCashierMemberExit(req.params.id, {
      paymentMethod: req.body?.paymentMethod,
      transferReference: req.body?.transferReference,
      cashierNote: req.body?.note || req.body?.cashierNote,
      processedBy: req.session?.user?.name || 'Cashier',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to complete exit payout.' });
  }
});

module.exports = router;
