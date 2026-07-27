const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  getAdminNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../services/adminNotificationService');

router.use(requireAuth, requirePermission('can_manage_chat', 'can_manage_members', 'can_view_reports'));

router.get('/', async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      getAdminNotifications(),
      getUnreadNotificationCount(),
    ]);
    return res.json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    await markAllNotificationsRead();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to mark notifications as read.' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const notification = await markNotificationRead(req.params.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    return res.json({ notification });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update notification.' });
  }
});

module.exports = router;
