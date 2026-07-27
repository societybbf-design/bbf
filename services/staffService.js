const User = require('../models/User');
const {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  getDefaultPermissions,
  sanitizePermissions,
  isFullAccessRole,
} = require('./rbac');

const DIRECTORY_ROLES = ['project_manager', 'cashier', 'employee', 'investor', 'member', 'ceo', 'admin'];

async function listStaffUsers() {
  const users = await User.find({
    role: { $in: DIRECTORY_ROLES },
    status: { $ne: 'deleted' },
  })
    .select('-password')
    .sort({ createdAt: -1 })
    .lean();

  return users.map((user) => ({
    ...user,
    roleLabel: ROLE_LABELS[user.role] || user.role,
  }));
}

async function createStaffUser({ name, email, password, role, permissions }, actor) {
  const error = new Error(
    'Account creation is restricted to User Management. Open User Management to create members, investors, project managers, and other roles.'
  );
  error.status = 403;
  throw error;
}

async function updateStaffUser(userId, { name, role, permissions, status, password }, actor) {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  if (isFullAccessRole(user.role) && String(user._id) === String(actor?.id)) {
    // CEO may update own name/password, not demote self
  }

  if (isFullAccessRole(user.role) && role && role !== user.role && role !== 'ceo') {
    const error = new Error('Cannot change the CEO role from this panel.');
    error.status = 400;
    throw error;
  }

  if (name) user.name = String(name).trim();

  if (role) {
    if (!ASSIGNABLE_ROLES.includes(role)) {
      const error = new Error('Invalid role.');
      error.status = 400;
      throw error;
    }
    if (!isFullAccessRole(user.role)) {
      user.role = role;
    }
  }

  if (Array.isArray(permissions)) {
    if (user.role === 'member') {
      user.permissions = [];
    } else {
      user.permissions = sanitizePermissions(permissions);
    }
  }

  if (status && ['active', 'inactive'].includes(status) && !isFullAccessRole(user.role)) {
    user.status = status;
  }

  if (password) {
    if (String(password).length < 6) {
      const error = new Error('Password must be at least 6 characters.');
      error.status = 400;
      throw error;
    }
    user.password = password;
  }

  await user.save();
  return user.toJSON();
}

module.exports = {
  listStaffUsers,
  createStaffUser,
  updateStaffUser,
  STAFF_ROLES: DIRECTORY_ROLES,
};
