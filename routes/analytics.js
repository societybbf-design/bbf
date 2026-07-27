const router = require('express').Router();
const { getFinancialTrends, getMemberFinancialTrends } = require('../services/analyticsService');
const { PAYMENT_CHANNELS } = require('../services/paymentChannelService');
const { requireAuth, requirePermission } = require('../middleware/auth');

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
    const memberId = req.query.memberId || req.session?.user?.id;
    if (!memberId) {
      return res.status(400).json({ error: 'Member ID is required.' });
    }
    if (req.session.user.role === 'member' && String(req.session.user.id) !== String(memberId)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    const trends = await getMemberFinancialTrends(memberId, { months: req.query.months });
    return res.json(trends);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load member trends.' });
  }
});

module.exports = router;
