const router = require('express').Router();
const { getFinancialTrends, getMemberFinancialTrends } = require('../services/analyticsService');
const { PAYMENT_CHANNELS } = require('../services/paymentChannelService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { userHasAnyPermission } = require('../services/rbac');

router.use(requireAuth);

router.get('/payment-channels', (req, res) => {
  res.json({ channels: PAYMENT_CHANNELS });
});

router.get('/financial-trends', requirePermission('can_view_reports', 'can_manage_deposits'), async (req, res) => {
  try {
    const trends = await getFinancialTrends({ months: req.query.months });
    return res.json(trends);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load financial trends.' });
  }
});

router.get('/member-trends', async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    const requestedId = req.query.memberId || sessionUser?.id;
    if (!requestedId) {
      return res.status(400).json({ error: 'Member ID is required.' });
    }

    const isSelf = String(sessionUser?.id) === String(requestedId);
    const canViewOthers = require('../services/rbac').userHasAnyPermission(
      sessionUser,
      ['can_manage_members', 'can_view_reports', 'can_manage_deposits']
    );
    if (!isSelf && !canViewOthers) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const trends = await getMemberFinancialTrends(requestedId, { months: req.query.months });
    return res.json(trends);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load member trends.' });
  }
});

module.exports = router;
