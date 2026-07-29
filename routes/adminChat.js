const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  getMessagesForMember,
  markMessagesReadForAdmin,
  getUnreadCountForAdmin,
  sendMessage,
  getAdminInbox,
  getChatDirectory,
  getStaffChatDirectory,
  getStaffMessages,
  markStaffMessagesRead,
  sendStaffMessage,
} = require('../services/chatService');

router.use(requireAuth, requirePermission('can_manage_chat'));

router.get('/inbox', async (req, res) => {
  try {
    const inbox = await getAdminInbox();
    return res.json({ inbox });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load message inbox.' });
  }
});

router.get('/directory', async (req, res) => {
  try {
    const directory = await getChatDirectory();
    return res.json({ directory });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load chat directory.' });
  }
});

router.get('/staff-directory', async (req, res) => {
  try {
    const directory = await getStaffChatDirectory(req.session.user);
    return res.json({ directory });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load staff directory.' });
  }
});

router.get('/staff/:userId/messages', async (req, res) => {
  try {
    const viewerId = req.session.user.id;
    const [messages] = await Promise.all([
      getStaffMessages(viewerId, req.params.userId),
      markStaffMessagesRead(viewerId, req.params.userId),
    ]);
    return res.json({ messages });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load staff messages.' });
  }
});

router.post('/staff/:userId/messages', async (req, res) => {
  try {
    const message = await sendStaffMessage({
      sender: req.session.user,
      peerId: req.params.userId,
      body: req.body?.body,
      replyTo: req.body?.replyTo || null,
      files: req.body?.files || [],
    });
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to send staff message.' });
  }
});

router.get('/members/:memberId/messages', async (req, res) => {
  try {
    const [messages, unreadCount] = await Promise.all([
      getMessagesForMember(req.params.memberId),
      getUnreadCountForAdmin(req.params.memberId),
    ]);
    await markMessagesReadForAdmin(req.params.memberId);
    return res.json({ messages, unreadCount });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load chat messages.' });
  }
});

router.post('/members/:memberId/messages', async (req, res) => {
  try {
    const message = await sendMessage({
      memberId: req.params.memberId,
      senderRole: 'admin',
      senderId: req.session.user.id,
      senderName: req.session.user.name || 'Cashier',
      body: req.body?.body,
      replyTo: req.body?.replyTo || null,
      files: req.body?.files || [],
    });
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to send message.' });
  }
});

router.patch('/members/:memberId/messages/read', async (req, res) => {
  try {
    await markMessagesReadForAdmin(req.params.memberId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to mark messages as read.' });
  }
});

module.exports = router;
