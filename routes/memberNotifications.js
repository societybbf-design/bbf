const router = require('express').Router();
const {
  getMemberNotifications,
  getUnreadMemberNotificationCount,
  markMemberNotificationRead,
  markAllMemberNotificationsRead,
} = require('../services/memberNotificationService');
const { requireActiveMember } = require('../middleware/memberAccess');

router.use(requireActiveMember);

router.get('/', async (req, res) => {
  try {
    const memberId = req.session.user.id;
    const [notifications, unreadCount] = await Promise.all([
      getMemberNotifications(memberId),
      getUnreadMemberNotificationCount(memberId),
    ]);
    return res.json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    await markAllMemberNotificationsRead(req.session.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to mark notifications as read.' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    await markMemberNotificationRead(req.session.user.id, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to mark notification as read.' });
  }
});

module.exports = router;
