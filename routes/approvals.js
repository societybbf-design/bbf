'use strict';

const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getApprovalsInbox, getApprovalsCounts } = require('../services/approvalsInboxService');
const { getCashierApprovalTracking } = require('../services/approvalTrackingService');

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

/**
 * Read-only Cashier view: who has / has not approved loans & projects.
 * Does not alter approval or disbursement state.
 */
router.get(
  '/tracking',
  requirePermission('can_disburse_loans', 'can_manage_deposits', 'can_manage_investments'),
  async (req, res) => {
    try {
      const data = await getCashierApprovalTracking();
      return res.json(data);
    } catch (err) {
      console.error('approvals tracking error', err);
      return res.status(err.status || 500).json({
        error: err.message || 'Failed to load approval tracking',
      });
    }
  }
);

module.exports = router;
