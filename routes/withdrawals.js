const router = require('express').Router();
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { createWithdrawalRequest, getWithdrawalRequestsForAdmin, updateWithdrawalRequestStatus } = require('../services/withdrawalService');
const { requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const { requireActiveMember } = require('../middleware/memberAccess');

const adminOnly = requirePermission('can_manage_withdrawals');

router.post('/member', requireActiveMember, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const { request, availability } = await createWithdrawalRequest({
      memberId: req.session.user.id,
      amount,
      reason,
    });

    return res.status(201).json({ request, availability });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to submit withdrawal request.' });
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

router.get('/admin', adminOnly, async (req, res) => {
  try {
    const requests = await getWithdrawalRequestsForAdmin();
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load withdrawal requests.' });
  }
});

router.patch('/admin/:id', adminOnly, requirePasswordConfirmation, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const request = await updateWithdrawalRequestStatus(req.params.id, status, adminNote);
    return res.json({ request });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update withdrawal request.' });
  }
});

module.exports = router;
