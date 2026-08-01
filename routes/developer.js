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
  assignableRolesForActor,
  clientIp,
} = require('../services/securityService');
const {
  ROLE_LABELS,
  PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  UM_EXCLUSIVE_PERMISSIONS,
  CASHIER_EXCLUSIVE_PERMISSIONS,
  PROJECT_MANAGER_BLOCKED_PERMISSIONS,
  isDeveloperRole,
} = require('../services/rbac');
const User = require('../models/User');
const {
  listPendingMemberApprovalQueues,
  proxyApproveInvestment,
  proxyApproveExit,
} = require('../services/memberApprovalProxyService');
const {
  umCreateRateLimit,
  umMutateRateLimit,
  otpVerifyRateLimit,
} = require('../services/requestRateLimit');

router.use(requireAuth, requireDeveloper);

const proxyMemberApprovals = requirePermission('can_proxy_member_approvals');

router.get('/meta', (req, res) => {
  const roles = assignableRolesForActor(req.session.user);
  const actorIsDeveloper = isDeveloperRole(req.session.user?.role);
  const permissions = actorIsDeveloper
    ? PERMISSIONS
    : PERMISSIONS.filter((row) => !UM_EXCLUSIVE_PERMISSIONS.includes(row.key));

  return res.json({
    roles: roles.map((role) => ({
      value: role,
      label: ROLE_LABELS[role],
      defaultPermissions: (DEFAULT_PERMISSIONS_BY_ROLE[role] || []).filter((key) => (
        actorIsDeveloper || !UM_EXCLUSIVE_PERMISSIONS.includes(key)
      )),
    })),
    permissions,
    cashierExclusivePermissions: [...CASHIER_EXCLUSIVE_PERMISSIONS],
    projectManagerBlockedPermissions: [
      ...CASHIER_EXCLUSIVE_PERMISSIONS,
      ...PROJECT_MANAGER_BLOCKED_PERMISSIONS,
    ],
    accountStatuses: ['active', 'inactive', 'blocked'],
    softDeleteEnabled: false,
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

router.post('/users', umCreateRateLimit.middleware(), async (req, res) => {
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

router.patch('/users/:id/email', umMutateRateLimit.middleware(), async (req, res) => {
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

router.patch('/users/:id/password', umMutateRateLimit.middleware(), async (req, res) => {
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

router.post('/users/:id/otp-reset', otpVerifyRateLimit.middleware(), async (req, res) => {
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

router.patch('/users/:id/status', umMutateRateLimit.middleware(), async (req, res) => {
  try {
    const user = await developerSetAccountStatus(
      req.params.id,
      req.body?.status,
      req.session.user,
      clientIp(req)
    );
    return res.json({
      message: `Account marked as ${user.status}.${user.status !== 'active' ? ' Active sessions were revoked.' : ''}`,
      user,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update status.' });
  }
});

/** Soft-delete removed — keep stubs so old clients get a clear 410. */
router.get('/users/:id/deletion-settlement', (_req, res) => {
  return res.status(410).json({
    error: 'Account deletion is disabled. Set the account to inactive or blocked instead.',
    canDelete: false,
    softDeleteEnabled: false,
  });
});

router.post('/users/:id/soft-delete', requirePasswordConfirmation, (_req, res) => {
  return res.status(410).json({
    error: 'Account deletion is disabled. Set the account to inactive or blocked instead so financial history stays intact.',
    softDeleteEnabled: false,
  });
});

router.post('/users/:id/restore', umMutateRateLimit.middleware(), async (req, res) => {
  try {
    // Legacy restore path now activates the account (no soft-delete lifecycle).
    const user = await developerSetAccountStatus(
      req.params.id,
      'active',
      req.session.user,
      clientIp(req)
    );
    return res.json({
      message: 'Account set to active.',
      user,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to activate account.' });
  }
});

router.post('/users/:id/unlock', umMutateRateLimit.middleware(), async (req, res) => {
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
