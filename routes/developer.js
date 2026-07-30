const router = require('express').Router();
const { requireAuth, requireDeveloper, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const {
  listUsersForDeveloper,
  getDeveloperDashboardStats,
  listRecentSecurityAudits,
  developerUpdateEmail,
  developerSetPassword,
  developerSetAccountStatus,
  developerUnlockAccount,
  verifyOtpAndResetPassword,
  sanitizeUserForDeveloper,
  createManagedUser,
  softDeleteUser,
  restoreSoftDeletedUser,
  clientIp,
} = require('../services/securityService');
const {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
} = require('../services/rbac');
const User = require('../models/User');
const {
  listPendingMemberApprovalQueues,
  proxyApproveInvestment,
  proxyApproveExit,
} = require('../services/memberApprovalProxyService');

router.use(requireAuth, requireDeveloper);

const proxyMemberApprovals = requirePermission('can_proxy_member_approvals');

router.get('/meta', (req, res) => {
  return res.json({
    roles: ASSIGNABLE_ROLES.map((role) => ({
      value: role,
      label: ROLE_LABELS[role],
      defaultPermissions: DEFAULT_PERMISSIONS_BY_ROLE[role] || [],
    })),
    permissions: PERMISSIONS,
  });
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getDeveloperDashboardStats();
    return res.json({ stats });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load user management stats.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await listUsersForDeveloper({
      q: req.query.q || '',
      role: req.query.role || '',
      status: req.query.status || '',
    });
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to list users.' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const result = await createManagedUser(req.body, req.session.user, clientIp(req));
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to create user.' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: sanitizeUserForDeveloper(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load user.' });
  }
});

router.patch('/users/:id/email', async (req, res) => {
  try {
    const user = await developerUpdateEmail(
      req.params.id,
      req.body?.email,
      req.session.user,
      clientIp(req)
    );
    return res.json({ message: 'Email updated successfully.', user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update email.' });
  }
});

router.patch('/users/:id/password', async (req, res) => {
  try {
    const user = await developerSetPassword(
      req.params.id,
      req.body?.password,
      req.session.user,
      clientIp(req)
    );
    return res.json({ message: 'Password updated successfully.', user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to set password.' });
  }
});

router.post('/users/:id/otp-reset', async (req, res) => {
  try {
    const user = await verifyOtpAndResetPassword({
      userId: req.params.id,
      otp: req.body?.otp,
      newPassword: req.body?.newPassword,
      actor: req.session.user,
      ip: clientIp(req),
    });
    return res.json({ message: 'OTP verified. Password reset and account unlocked.', user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'OTP reset failed.' });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const user = await developerSetAccountStatus(
      req.params.id,
      req.body?.status,
      req.session.user,
      clientIp(req)
    );
    return res.json({ message: `Account marked as ${user.status}.`, user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update status.' });
  }
});

router.get('/users/:id/deletion-settlement', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('role name email status');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.role !== 'member') {
      return res.json({
        requiresSettlement: false,
        settlementAmount: 0,
        canDelete: user.status !== 'deleted',
        blockers: user.status === 'deleted' ? ['Account is already soft-deleted.'] : [],
        member: null,
        nonMember: true,
        message: 'Non-member staff accounts have no society balances to settle.',
      });
    }
    const {
      getMemberDeletionSettlementPreview,
    } = require('../services/memberLifecycleService');
    const preview = await getMemberDeletionSettlementPreview(req.params.id);
    return res.json(preview);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load deletion settlement preview.',
      settlementPreview: error.settlementPreview || null,
    });
  }
});

router.post('/users/:id/soft-delete', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await softDeleteUser(
      req.params.id,
      {
        reason: req.body?.reason || '',
        deletedBy: req.session?.user?.name || req.session?.user?.email || '',
        confirmSettlementAmount: req.body?.confirmSettlementAmount,
        settleBalances: req.body?.settleBalances !== false,
      },
      req.session.user,
      clientIp(req)
    );
    const settlement = result.settlement;
    let message = 'Account soft-deleted. Financial records were preserved and can be restored from User Management.';
    if (settlement && Number(settlement.settlementAmount) > 0) {
      message = `Member settled and soft-deleted. Payout ${Number(settlement.settlementAmount).toFixed(2)} `
        + `(book debit ${Number(settlement.bookPayable || 0).toFixed(2)}`
        + (Number(settlement.reserveShare) > 0
          ? ` + reserve ${Number(settlement.reserveShare).toFixed(2)}`
          : '')
        + `). Central book balance now ${
          settlement.bookBalanceAfter != null ? Number(settlement.bookBalanceAfter).toFixed(2) : '—'
        }.`;
    }
    return res.json({
      message,
      user: result.user || result,
      settlement: settlement || null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to soft-delete account.',
      settlementPreview: error.settlementPreview || null,
    });
  }
});

router.post('/users/:id/restore', async (req, res) => {
  try {
    const user = await restoreSoftDeletedUser(req.params.id, req.session.user, clientIp(req));
    return res.json({
      message: 'Account restored to active with previous identity and linked financial history intact.',
      user,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to restore account.' });
  }
});

router.post('/users/:id/unlock', async (req, res) => {
  try {
    const user = await developerUnlockAccount(req.params.id, req.session.user, clientIp(req));
    return res.json({ message: 'Account lock cleared.', user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to unlock account.' });
  }
});

router.get('/audits', async (req, res) => {
  try {
    const audits = await listRecentSecurityAudits(req.query.limit);
    return res.json({ audits });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load audits.' });
  }
});

router.get('/member-approvals/pending', async (req, res) => {
  try {
    const data = await listPendingMemberApprovalQueues();
    return res.json(data);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load pending member approvals.' });
  }
});

router.post('/member-approvals/investments/:id/proxy', proxyMemberApprovals, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await proxyApproveInvestment(
      req.params.id,
      req.body?.memberId,
      req.session.user,
      { reason: req.body?.reason, ip: clientIp(req) }
    );
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record proxy approval.' });
  }
});

router.post('/member-approvals/exits/:id/proxy', proxyMemberApprovals, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await proxyApproveExit(
      req.params.id,
      req.body?.memberId,
      req.session.user,
      { reason: req.body?.reason, ip: clientIp(req) }
    );
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record proxy approval.' });
  }
});

module.exports = router;
