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
  /** Third-party co-funders who own a % of society projects (not internal investees). */
  EXTERNAL_INVESTOR: 'external_investor',
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
  external_investor: 'External Investor',
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
  'external_investor',
  'member',
]);

/** @deprecated CEO panel no longer creates users — kept for meta/read compatibility */
const CEO_PANEL_ASSIGNABLE_ROLES = Object.freeze([
  'project_manager',
  'cashier',
  'employee',
  'investor',
  'external_investor',
  'member',
]);

const ALL_ROLES = Object.freeze([
  'developer',
  'ceo',
  'project_manager',
  'cashier',
  'employee',
  'investor',
  'external_investor',
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
    description: 'Record, receive, and verify member deposits (Cashier only).',
  },
  {
    key: 'can_manage_withdrawals',
    label: 'Review withdrawals',
    description: 'Approve or reject member withdrawal requests (CEO). Cashier disbursement is separate.',
  },
  {
    key: 'can_disburse_withdrawals',
    label: 'Disburse withdrawals',
    description: 'Pay CEO-approved withdrawals from the member Advance Balance (Cashier only).',
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
    label: 'Review refund requests',
    description: 'Approve or reject member refund requests (CEO). Cashier disbursement is separate.',
  },
  {
    key: 'can_disburse_refunds',
    label: 'Disburse refunds',
    description: 'Pay CEO-approved refunds from the society bank ledger (Cashier only).',
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
  {
    key: 'can_proxy_member_approvals',
    label: 'Proxy member approvals',
    description: 'Record society member votes on behalf of absent members from User Management (does not affect CEO or Cashier steps).',
  },
]);

const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((p) => p.key));

/** Permissions that must never be auto-granted via CEO/developer full-access bypass. */
const CASHIER_EXCLUSIVE_PERMISSIONS = Object.freeze([
  'can_disburse_loans',
  'can_manage_deposits',
  'can_disburse_refunds',
  'can_disburse_withdrawals',
]);

/**
 * Extra finance controls Project Managers must never receive via UM grants.
 * (Cashier-exclusive keys are stripped separately for all non-cashier roles.)
 */
const PROJECT_MANAGER_BLOCKED_PERMISSIONS = Object.freeze([
  'can_manage_profit',
  'can_manage_withdrawals',
  'can_manage_refunds',
]);

/** User Management–only permissions (developer role or explicit grant — not CEO full-access bypass). */
const UM_EXCLUSIVE_PERMISSIONS = Object.freeze(['can_manage_security', 'can_proxy_member_approvals']);

const DEFAULT_PERMISSIONS_BY_ROLE = Object.freeze({
  developer: PERMISSION_KEYS.filter((key) => !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)),
  ceo: PERMISSION_KEYS.filter(
    (key) => !UM_EXCLUSIVE_PERMISSIONS.includes(key) && !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)
  ),
  admin: PERMISSION_KEYS.filter(
    (key) => !UM_EXCLUSIVE_PERMISSIONS.includes(key) && !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)
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
    'can_disburse_withdrawals',
    'can_disburse_refunds',
    'can_disburse_loans',
    'can_manage_profit',
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
  external_investor: [
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
  external_investor: '/dashboard/investor',
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

function isUmExclusivePermission(permissionKey) {
  return UM_EXCLUSIVE_PERMISSIONS.includes(permissionKey);
}

function userHasPermission(user, permissionKey) {
  if (!user) return false;

  // Loan payout/repayment is Cashier-only — never granted by CEO/developer full-access bypass.
  if (isCashierExclusivePermission(permissionKey)) {
    return normalizeRole(user.role) === 'cashier';
  }

  // User Management–only actions — developer role or explicit permission grant.
  if (isUmExclusivePermission(permissionKey)) {
    if (isDeveloperRole(user.role)) return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes(permissionKey);
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
  // Ensure cashiers retain deposit management even if stored permissions predate the exclusive grant.
  if (normalizeRole(role) === 'cashier' && !permissions.includes('can_manage_deposits')) {
    permissions = [...permissions, 'can_manage_deposits'];
  }
  if (normalizeRole(role) === 'cashier' && !permissions.includes('can_disburse_refunds')) {
    permissions = [...permissions, 'can_disburse_refunds'];
  }
  if (normalizeRole(role) === 'cashier' && !permissions.includes('can_disburse_withdrawals')) {
    permissions = [...permissions, 'can_disburse_withdrawals'];
  }
  // Refund/withdrawal review stays with CEO; strip legacy review keys from cashier sessions.
  if (normalizeRole(role) === 'cashier') {
    permissions = permissions.filter(
      (key) => key !== 'can_manage_refunds' && key !== 'can_manage_withdrawals'
    );
  }
  // Ensure cashiers retain Profit & Loss management even if stored permissions predate the grant.
  if (normalizeRole(role) === 'cashier' && !permissions.includes('can_manage_profit')) {
    permissions = [...permissions, 'can_manage_profit'];
  }
  // Never expose cashier-exclusive perms on non-cashier session payloads.
  if (normalizeRole(role) !== 'cashier') {
    permissions = permissions.filter((key) => !isCashierExclusivePermission(key));
  }
  // Project Manager sessions never carry payout / deposit-adjacent finance controls.
  if (normalizeRole(role) === 'project_manager') {
    permissions = permissions.filter((key) => !PROJECT_MANAGER_BLOCKED_PERMISSIONS.includes(key));
  }
  // UM-exclusive perms only when explicitly granted (developer role handled above).
  if (!isDeveloperRole(role)) {
    const explicit = new Set(sanitizePermissions(userDoc.permissions || []));
    permissions = permissions.filter((key) => !isUmExclusivePermission(key) || explicit.has(key));
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
  PROJECT_MANAGER_BLOCKED_PERMISSIONS,
  UM_EXCLUSIVE_PERMISSIONS,
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
  isUmExclusivePermission,
  userHasPermission,
  userHasAnyPermission,
  dashboardPathForRole,
  publicUserPayload,
};
