const router = require('express').Router();
const WithdrawalRequest = require('../models/WithdrawalRequest');
const {
  createWithdrawalRequest,
  getWithdrawalRequestsForAdmin,
  listCeoPendingWithdrawals,
  listCashierWithdrawalQueue,
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawalPayout,
  updateWithdrawalRequestStatus,
} = require('../services/withdrawalService');
const {
  requirePermission,
  requirePasswordConfirmation,
  requireAuth,
} = require('../middleware/auth');
const { requireActiveMember } = require('../middleware/memberAccess');
const { userHasPermission } = require('../services/rbac');
const { clientIp } = require('../services/securityService');

const manageWithdrawals = requirePermission('can_manage_withdrawals');
const disburseWithdrawals = requirePermission('can_disburse_withdrawals');

function requireCashierRole(req, res, next) {
  if (req.session?.user?.role === 'cashier') return next();
  return res.status(403).json({ error: 'Only the Cashier can disburse withdrawals.' });
}

router.post('/member', requireActiveMember, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const { request, availability } = await createWithdrawalRequest({
      memberId: req.session.user.id,
      amount,
      reason,
    });

    return res.status(201).json({
      request,
      availability,
      message: 'Withdrawal request submitted for CEO approval. Payouts are paid only from your Advance Balance.',
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to submit withdrawal request.',
      availability: error.availability || undefined,
    });
  }
});

router.get('/member', requireActiveMember, async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find({ member: req.session.user.id }).sort({ createdAt: -1 });
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load withdrawal requests.' });
  }
});

/** CEO: all requests (for review dashboard). */
router.get('/admin', manageWithdrawals, async (req, res) => {
  try {
    const requests = await getWithdrawalRequestsForAdmin();
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load withdrawal requests.' });
  }
});

router.get('/admin/pending', manageWithdrawals, async (req, res) => {
  try {
    const requests = await listCeoPendingWithdrawals();
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load pending withdrawals.' });
  }
});

/** Cashier: CEO-approved payout queue with advance-balance flags. */
router.get('/cashier-queue', disburseWithdrawals, requireCashierRole, async (req, res) => {
  try {
    const requests = await listCashierWithdrawalQueue();
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load withdrawal payout queue.' });
  }
});

router.post('/admin/:id/approve', manageWithdrawals, requirePasswordConfirmation, async (req, res) => {
  try {
    const request = await approveWithdrawal(req.params.id, {
      reviewedBy: req.session?.user?.name || 'CEO',
      adminNote: req.body?.adminNote || '',
      actor: req.session?.user || null,
      ip: clientIp(req),
    });
    return res.json({
      request,
      message: 'Withdrawal approved and sent to the Cashier payment queue.',
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to approve withdrawal.',
      availability: error.availability || undefined,
    });
  }
});

router.post('/admin/:id/reject', manageWithdrawals, requirePasswordConfirmation, async (req, res) => {
  try {
    const request = await rejectWithdrawal(req.params.id, {
      reviewedBy: req.session?.user?.name || 'CEO',
      adminNote: req.body?.adminNote || '',
      actor: req.session?.user || null,
      ip: clientIp(req),
    });
    return res.json({ request, message: 'Withdrawal request rejected.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to reject withdrawal.',
    });
  }
});

router.post('/admin/:id/cashier-complete', disburseWithdrawals, requireCashierRole, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await processWithdrawalPayout(req.params.id, {
      processedBy: req.session?.user?.name || 'Cashier',
      paymentMethod: req.body?.paymentMethod || 'cash',
      disbursementReference: req.body?.disbursementReference || '',
      adminNote: req.body?.adminNote || '',
      actor: req.session?.user || null,
      ip: clientIp(req),
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to process withdrawal payout.',
      availability: error.availability || undefined,
    });
  }
});

/** Legacy PATCH bridge — enforces CEO review vs Cashier disbursement. */
router.patch('/admin/:id', requireAuth, requirePasswordConfirmation, async (req, res) => {
  try {
    const { status, adminNote, paymentMethod, disbursementReference } = req.body;
    const role = req.session?.user?.role;
    const canReview = userHasPermission(req.session?.user, 'can_manage_withdrawals')
      || role === 'ceo'
      || role === 'admin'
      || role === 'developer';
    const canDisburse = userHasPermission(req.session?.user, 'can_disburse_withdrawals') && role === 'cashier';

    const request = await updateWithdrawalRequestStatus(req.params.id, status, adminNote, {
      paymentMethod,
      disbursementReference,
      actor: req.session?.user || null,
      actorName: req.session?.user?.name || '',
      role,
      canReview,
      canDisburse,
      ip: clientIp(req),
    });
    return res.json({ request });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to update withdrawal request.',
      availability: error.availability || undefined,
    });
  }
});

module.exports = router;
