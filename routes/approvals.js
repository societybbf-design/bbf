'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getApprovalsInbox, getApprovalsCounts } = require('../services/approvalsInboxService');

const router = express.Router();

router.use(requireAuth);

router.get('/inbox', async (req, res) => {
  try {
    const data = await getApprovalsInbox(req.session.user);
    return res.json({ ok: true, ...data });
  } catch (err) {
    console.error('approvals inbox error', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to load approvals inbox' });
  }
});

router.get('/counts', async (req, res) => {
  try {
    const data = await getApprovalsCounts(req.session.user);
    return res.json({ ok: true, ...data });
  } catch (err) {
    console.error('approvals counts error', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to load approvals counts' });
  }
});

module.exports = router;
