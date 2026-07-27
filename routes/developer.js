const router = require('express').Router();
const { requireAuth, requireDeveloper } = require('../middleware/auth');
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

router.use(requireAuth, requireDeveloper);

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

router.get('/entry-valuation', async (req, res) => {
  try {
    const { getEntryValuation } = require('../services/memberMigrationService');
    const valuation = await getEntryValuation({
      replaceMemberId: req.query.replaceMemberId || null,
    });
    return res.json({ valuation });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load entry valuation.' });
  }
});

router.post('/members/:id/buy-in', async (req, res) => {
  try {
    const { completeMemberBuyIn } = require('../services/memberMigrationService');
    const result = await completeMemberBuyIn({
      memberId: req.params.id,
      amountPaid: req.body?.amountPaid ?? req.body?.amount,
      notes: req.body?.notes || '',
      recordedBy: req.session?.user?.name || 'User Management',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to complete member buy-in.' });
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

router.post('/users/:id/soft-delete', async (req, res) => {
  try {
    const user = await softDeleteUser(
      req.params.id,
      {
        reason: req.body?.reason || '',
        deletedBy: req.session?.user?.name || req.session?.user?.email || '',
      },
      req.session.user,
      clientIp(req)
    );
    return res.json({
      message: 'Account soft-deleted. Financial records were preserved and can be restored from User Management.',
      user,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to soft-delete account.' });
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

module.exports = router;
