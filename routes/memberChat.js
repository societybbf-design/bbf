const router = require('express').Router();
const {
  getMessagesForMember,
  markMessagesReadForMember,
  getUnreadCountForMember,
  sendMessage,
} = require('../services/chatService');
const { requireActiveMember } = require('../middleware/memberAccess');

router.use(requireActiveMember);

router.get('/', async (req, res) => {
  try {
    const memberId = req.session.user.id;
    const [messages, unreadCount] = await Promise.all([
      getMessagesForMember(memberId),
      getUnreadCountForMember(memberId),
    ]);
    await markMessagesReadForMember(memberId);
    return res.json({ messages, unreadCount });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load chat messages.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const memberId = req.session.user.id;
    const message = await sendMessage({
      memberId,
      senderRole: 'member',
      senderId: memberId,
      senderName: req.memberRecord?.name || req.session.user.name || 'Member',
      body: req.body?.body,
      replyTo: req.body?.replyTo || null,
      files: req.body?.files || [],
    });
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to send message.' });
  }
});

router.patch('/read', async (req, res) => {
  try {
    await markMessagesReadForMember(req.session.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to mark messages as read.' });
  }
});

module.exports = router;
