'use strict';

const express = require('express');
const {
  getExternalInvestorDashboard,
  decideExternalPayoutRequest,
  submitProjectManagerReview,
  getExternalInvestorChatPeers,
} = require('../services/externalInvestorPortalService');
const { decideExternalExpenseApproval } = require('../services/projectOpsService');
const {
  getStaffMessages,
  sendStaffMessage,
  markStaffMessagesRead,
} = require('../services/chatService');

const router = express.Router();

function requireExternalInvestor(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (String(user.role || '').toLowerCase() !== 'external_investor') {
    return res.status(403).json({ error: 'External Investor access only.' });
  }
  return next();
}

router.use(requireExternalInvestor);

router.get('/dashboard', async (req, res) => {
  try {
    const data = await getExternalInvestorDashboard(req.session.user);
    return res.json(data);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load external investor dashboard.',
    });
  }
});

router.post('/payouts/:id/decide', async (req, res) => {
  try {
    const approve = !(
      req.body?.approve === false
      || req.body?.decision === 'rejected'
      || req.body?.status === 'rejected'
    );
    const result = await decideExternalPayoutRequest(req.session.user, req.params.id, {
      approve,
      note: req.body?.note || '',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to update payout request.',
    });
  }
});

router.post('/reviews', async (req, res) => {
  try {
    const result = await submitProjectManagerReview(req.session.user, {
      investmentId: req.body?.investmentId,
      rating: req.body?.rating,
      feedback: req.body?.feedback || '',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to submit review.',
    });
  }
});

router.post('/expenses/:id/decide', async (req, res) => {
  try {
    const approve = !(
      req.body?.approve === false
      || req.body?.decision === 'rejected'
      || req.body?.status === 'rejected'
    );
    const result = await decideExternalExpenseApproval(req.session.user, req.params.id, {
      approve,
      note: req.body?.note || '',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to update expense approval.',
    });
  }
});

router.get('/chat/peers', async (req, res) => {
  try {
    const peers = await getExternalInvestorChatPeers(req.session.user);
    return res.json({ peers });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load chat peers.',
    });
  }
});

router.get('/chat/:peerId', async (req, res) => {
  try {
    const peers = await getExternalInvestorChatPeers(req.session.user);
    const allowed = peers.some((p) => String(p.userId) === String(req.params.peerId));
    if (!allowed) {
      return res.status(403).json({ error: 'You can only chat with the CEO or your assigned Project Manager.' });
    }
    const viewerId = req.session.user.id || req.session.user._id;
    const [messages] = await Promise.all([
      getStaffMessages(viewerId, req.params.peerId, {
        limit: Number(req.query.limit) || 80,
      }),
      markStaffMessagesRead(viewerId, req.params.peerId),
    ]);
    return res.json({ messages });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load conversation.',
    });
  }
});

router.post('/chat/:peerId', async (req, res) => {
  try {
    const peers = await getExternalInvestorChatPeers(req.session.user);
    const allowed = peers.some((p) => String(p.userId) === String(req.params.peerId));
    if (!allowed) {
      return res.status(403).json({ error: 'You can only chat with the CEO or your assigned Project Manager.' });
    }
    const message = await sendStaffMessage({
      sender: req.session.user,
      peerId: req.params.peerId,
      body: req.body?.body || req.body?.message || '',
      replyTo: req.body?.replyTo || null,
      files: req.body?.files || req.body?.attachments || [],
    });
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to send message.',
    });
  }
});

router.post('/chat/:peerId/read', async (req, res) => {
  try {
    const peers = await getExternalInvestorChatPeers(req.session.user);
    const allowed = peers.some((p) => String(p.userId) === String(req.params.peerId));
    if (!allowed) {
      return res.status(403).json({ error: 'Conversation not available.' });
    }
    const viewerId = req.session.user.id || req.session.user._id;
    const result = await markStaffMessagesRead(viewerId, req.params.peerId);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to mark conversation read.',
    });
  }
});

module.exports = router;
