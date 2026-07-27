/**
 * Role-Based Access Control catalog and helpers for Bondhutto-er Bandhon Foundation.
 */

const ROLES = Object.freeze({
  DEVELOPER: 'developer',
  CEO: 'ceo',
  PROJECT_MANAGER: 'project_manager',
  CASHIER: 'cashier',
  EMPLOYEE: 'employee',
  INVESTOR: 'investor',
  MEMBER: 'member',
  /** @deprecated legacy alias for ceo */
  ADMIN: 'admin',
});

const ROLE_LABELS = Object.freeze({
  developer: 'User Management Admin',
  ceo: 'CEO',
  project_manager: 'Project Manager',
  cashier: 'Cashier',
  employee: 'Employee',
  investor: 'Investor',
  member: 'Member',
  admin: 'Admin (legacy)',
});

/** Roles assignable from the User Management panel (never developer) */
const ASSIGNABLE_ROLES = Object.freeze([
  'ceo',
  'project_manager',
  'cashier',
  'employee',
  'investor',
  'member',
]);

/** @deprecated CEO panel no longer creates users — kept for meta/read compatibility */
const CEO_PANEL_ASSIGNABLE_ROLES = Object.freeze([
  'project_manager',
  'cashier',
  'employee',
  'investor',
  'member',
]);

const ALL_ROLES = Object.freeze([
  'developer',
  'ceo',
  'project_manager',
  'cashier',
  'employee',
  'investor',
  'member',
  'admin',
]);

const PERMISSIONS = Object.freeze([
  {
    key: 'can_manage_staff',
    label: 'Manage staff users',
    description: 'Create and edit staff accounts and permissions (CEO only by default).',
  },
  {
    key: 'can_manage_members',
    label: 'Manage members',
    description: 'View and manage society members.',
  },
  {
    key: 'can_manage_deposits',
    label: 'Manage deposits',
    description: 'Record and view member deposits.',
  },
  {
    key: 'can_manage_withdrawals',
    label: 'Manage withdrawals',
    description: 'Review and process withdrawal requests.',
  },
  {
    key: 'can_manage_loans',
    label: 'Review loan applications',
    description: 'Review, approve, or reject member loan applications (CEO). Disbursement and repayments stay with the Cashier.',
  },
  {
    key: 'can_disburse_loans',
    label: 'Disburse loans & record repayments',
    description: 'Process approved loan payouts and record loan repayments (Cashier only).',
  },
  {
    key: 'can_manage_investments',
    label: 'Manage investments',
    description: 'Create and manage society investments.',
  },
  {
    key: 'can_manage_ious',
    label: 'Manage IOUs',
    description: 'Create and manage investment IOUs.',
  },
  {
    key: 'can_manage_profit',
    label: 'Manage profit & dividends',
    description: 'Distribute profit and record investment P&L.',
  },
  {
    key: 'can_manage_refunds',
    label: 'Manage refunds',
    description: 'Create and complete member refunds.',
  },
  {
    key: 'can_manage_kyc',
    label: 'Manage KYC',
    description: 'Review member KYC documents.',
  },
  {
    key: 'can_view_reports',
    label: 'View reports',
    description: 'Access summaries and contribution reports.',
  },
  {
    key: 'can_manage_notices',
    label: 'Manage notices',
    description: 'Publish society notices.',
  },
  {
    key: 'can_manage_chat',
    label: 'Manage chat',
    description: 'Access admin chat inbox.',
  },
  {
    key: 'can_manage_security',
    label: 'Manage platform security',
    description: 'Absolute account control, lockouts, OTP recovery, and email updates (User Management).',
  },
]);

const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((p) => p.key));

/** Permissions that must never be auto-granted via CEO/developer full-access bypass. */
const CASHIER_EXCLUSIVE_PERMISSIONS = Object.freeze(['can_disburse_loans']);

const DEFAULT_PERMISSIONS_BY_ROLE = Object.freeze({
  developer: PERMISSION_KEYS.filter((key) => !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)),
  ceo: PERMISSION_KEYS.filter(
    (key) => key !== 'can_manage_security' && !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)
  ),
  admin: PERMISSION_KEYS.filter(
    (key) => key !== 'can_manage_security' && !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)
  ),
  project_manager: [
    'can_manage_members',
    'can_manage_investments',
    'can_manage_ious',
    'can_manage_kyc',
    'can_view_reports',
    'can_manage_notices',
    'can_manage_chat',
  ],
  cashier: [
    'can_manage_deposits',
    'can_manage_withdrawals',
    'can_manage_refunds',
    'can_disburse_loans',
    'can_view_reports',
    'can_manage_chat',
    'can_manage_members',
  ],
  employee: [
    'can_view_reports',
    'can_manage_kyc',
  ],
  investor: [
    'can_view_reports',
  ],
  member: [],
});

const DASHBOARD_PATHS = Object.freeze({
  developer: '/user-management',
  ceo: '/admin',
  admin: '/admin',
  project_manager: '/dashboard/project-manager',
  cashier: '/dashboard/cashier',
  employee: '/dashboard/employee',
  investor: '/dashboard/investor',
  member: '/member',
});

function normalizeRole(role) {
  if (role === 'admin') return 'ceo';
  return role;
}

function isDeveloperRole(role) {
  return role === 'developer';
}

/** CEO / legacy admin operational full access (not Developer absolute control) */
function isFullAccessRole(role) {
  return role === 'ceo' || role === 'admin';
}

/** Platform absolute authority — Developer role */
function isAbsoluteControlRole(role) {
  return isDeveloperRole(role);
}

/** Who may open the User Management module in the CEO dashboard (CEO or Developer) */
function canAccessDeveloperModule(role) {
  return isDeveloperRole(role) || isFullAccessRole(role);
}

function getDefaultPermissions(role) {
  const key = normalizeRole(role);
  if (role === 'developer') return [...(DEFAULT_PERMISSIONS_BY_ROLE.developer || [])];
  return [...(DEFAULT_PERMISSIONS_BY_ROLE[key] || DEFAULT_PERMISSIONS_BY_ROLE[role] || [])];
}

function sanitizePermissions(list) {
  if (!Array.isArray(list)) return [];
  const allowed = new Set(PERMISSION_KEYS);
  return [...new Set(list.map(String).filter((key) => allowed.has(key)))];
}

function isCashierExclusivePermission(permissionKey) {
  return CASHIER_EXCLUSIVE_PERMISSIONS.includes(permissionKey);
}

function userHasPermission(user, permissionKey) {
  if (!user) return false;

  // Loan payout/repayment is Cashier-only — never granted by CEO/developer full-access bypass.
  if (isCashierExclusivePermission(permissionKey)) {
    return normalizeRole(user.role) === 'cashier';
  }

  if (isAbsoluteControlRole(user.role) || isFullAccessRole(user.role)) return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes(permissionKey);
}

function userHasAnyPermission(user, permissionKeys) {
  if (!user) return false;
  return permissionKeys.some((key) => userHasPermission(user, key));
}

function dashboardPathForRole(role) {
  return DASHBOARD_PATHS[role] || DASHBOARD_PATHS.member;
}

function publicUserPayload(userDoc) {
  const role = userDoc.role;
  let permissions;
  if (isAbsoluteControlRole(role)) {
    permissions = getDefaultPermissions('developer');
  } else if (isFullAccessRole(role)) {
    permissions = getDefaultPermissions('ceo');
  } else {
    permissions = sanitizePermissions(userDoc.permissions || getDefaultPermissions(role));
  }

  // Keep cashier loan-disbursement capability even if stored permissions predates the new key.
  if (normalizeRole(role) === 'cashier' && !permissions.includes('can_disburse_loans')) {
    permissions = [...permissions, 'can_disburse_loans'];
  }
  // Never expose cashier-exclusive perms on non-cashier session payloads.
  if (normalizeRole(role) !== 'cashier') {
    permissions = permissions.filter((key) => !isCashierExclusivePermission(key));
  }

  return {
    id: userDoc._id,
    email: userDoc.email,
    role,
    name: userDoc.name,
    permissions,
    preferredLanguage: userDoc.preferredLanguage || 'bn',
    redirectTo: dashboardPathForRole(role),
  };
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ASSIGNABLE_ROLES,
  CEO_PANEL_ASSIGNABLE_ROLES,
  ALL_ROLES,
  PERMISSIONS,
  PERMISSION_KEYS,
  CASHIER_EXCLUSIVE_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  DASHBOARD_PATHS,
  normalizeRole,
  isDeveloperRole,
  isFullAccessRole,
  isAbsoluteControlRole,
  canAccessDeveloperModule,
  getDefaultPermissions,
  sanitizePermissions,
  isCashierExclusivePermission,
  userHasPermission,
  userHasAnyPermission,
  dashboardPathForRole,
  publicUserPayload,
};
