const User = require('../models/User');
const { requireAuth } = require('./auth');
const {
  isFullAccessRole,
  isDeveloperRole,
  userHasPermission,
} = require('../services/rbac');

/** Read-only cashier deposit transparency — Project Manager intentionally excluded. */
const STAFF_TRANSPARENCY_ROLES = new Set([
  'investor',
  'employee',
  'cashier',
]);

/**
 * Read-only society cashier transparency — members and non-admin staff.
 * CEO / developer / cashier with deposit permission may also use admin APIs;
 * this endpoint is safe for all authenticated society users.
 */
function requireCashierTrackingRead(req, res, next) {
  return requireAuth(req, res, () => {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (isDeveloperRole(user.role) || isFullAccessRole(user.role)) {
      return next();
    }

    if (user.role === 'cashier' || STAFF_TRANSPARENCY_ROLES.has(user.role)) {
      return next();
    }

    if (user.role !== 'member') {
      return res.status(403).json({ error: 'Cashier tracking is not available for your role.' });
    }

    return User.findById(user.id)
      .select('status role')
      .then((member) => {
        if (!member || member.role !== 'member') {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (member.status === 'inactive') {
          return res.status(403).json({ error: 'Your account is inactive. Please contact the admin.' });
        }
        if (member.status === 'deleted') {
          return res.status(403).json({ error: 'Your account has been removed from the society.' });
        }
        return next();
      })
      .catch(() => res.status(500).json({ error: 'Unable to verify access.' }));
  });
}

function canManageCashierLedger(user) {
  if (!user) return false;
  if (isDeveloperRole(user.role) || isFullAccessRole(user.role)) return true;
  return userHasPermission(user, 'can_manage_deposits');
}

module.exports = {
  requireCashierTrackingRead,
  canManageCashierLedger,
};
