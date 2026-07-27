const router = require('express').Router();
const {
  listMembersNeedingReminder,
  sendDuesReminders,
} = require('../services/duesReminderService');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits', 'can_view_reports'));

router.get('/unpaid', async (req, res) => {
  try {
    const members = await listMembersNeedingReminder({ yearMonth: req.query.yearMonth });
    return res.json({ members, count: members.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load unpaid members.' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const result = await sendDuesReminders({
      yearMonth: req.body?.yearMonth,
      memberIds: Array.isArray(req.body?.memberIds) ? req.body.memberIds : [],
      actor: req.session?.user || null,
      channel: req.body?.channel || 'all',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to send dues reminders.' });
  }
});

module.exports = router;
