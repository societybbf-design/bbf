const router = require('express').Router();
const { listAdminActivities, ADMIN_ACTIONS } = require('../services/activityLogService');
const { requireAuth, requireCeo } = require('../middleware/auth');

router.use(requireAuth, requireCeo);

router.get('/actions', (req, res) => {
  res.json({ actions: ADMIN_ACTIONS });
});

router.get('/', async (req, res) => {
  try {
    const result = await listAdminActivities({
      limit: req.query.limit,
      offset: req.query.offset,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load activity log.' });
  }
});

module.exports = router;
