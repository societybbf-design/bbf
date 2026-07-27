const router = require('express').Router();
const { requireAuth, requireCeo } = require('../middleware/auth');
const {
  PERMISSIONS,
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  DEFAULT_PERMISSIONS_BY_ROLE,
} = require('../services/rbac');
const { listStaffUsers, updateStaffUser } = require('../services/staffService');

router.use(requireAuth, requireCeo);

router.get('/meta', (req, res) => {
  res.json({
    roles: ASSIGNABLE_ROLES.map((role) => ({
      value: role,
      label: ROLE_LABELS[role],
      defaultPermissions: DEFAULT_PERMISSIONS_BY_ROLE[role] || [],
    })),
    permissions: PERMISSIONS,
  });
});

router.get('/staff', async (req, res) => {
  try {
    const staff = await listStaffUsers();
    return res.json({ staff });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load staff users.' });
  }
});

router.post('/staff', async (req, res) => {
  return res.status(403).json({
    error: 'Account creation is restricted to User Management. Open User Management to create members, investors, project managers, and other roles.',
  });
});

router.patch('/staff/:id', async (req, res) => {
  try {
    if (req.body?.password || req.body?.status) {
      return res.status(403).json({
        error: 'Password and status changes are restricted to User Management.',
      });
    }
    const user = await updateStaffUser(req.params.id, req.body, req.session.user);
    return res.json({ user });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update user.' });
  }
});

module.exports = router;
