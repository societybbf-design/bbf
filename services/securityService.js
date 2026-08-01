const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SecurityAudit = require('../models/SecurityAudit');
const { sendTransactionalEmail } = require('./notificationService');
const { getOrganizationName } = require('./organizationBranding');
const {
  ROLE_LABELS,
  isDeveloperRole,
  isFullAccessRole,
  ASSIGNABLE_ROLES,
  CEO_PANEL_ASSIGNABLE_ROLES,
  getDefaultPermissions,
  sanitizePermissions,
  UM_EXCLUSIVE_PERMISSIONS,
  CASHIER_EXCLUSIVE_PERMISSIONS,
  PROJECT_MANAGER_BLOCKED_PERMISSIONS,
} = require('./rbac');

const MAX_FAILED_ATTEMPTS = Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
const LOCK_DURATION_MS = Number(process.env.ACCOUNT_LOCK_MS) || 24 * 60 * 60 * 1000;
/** Strict OTP expiry — default 10 minutes (override via PASSWORD_OTP_TTL_MS). */
const OTP_TTL_MS = Number(process.env.PASSWORD_OTP_TTL_MS) || 10 * 60 * 1000;
const OTP_LENGTH = 6;
const OTP_RATE_LIMIT_MS = Number(process.env.PASSWORD_OTP_RATE_LIMIT_MS) || 60 * 1000;
const OTP_RATE_LIMIT_MAX = Number(process.env.PASSWORD_OTP_RATE_LIMIT_MAX) || 3;
const OTP_MAX_VERIFY_FAILURES = Number(process.env.PASSWORD_OTP_MAX_FAILURES) || 5;
const otpRequestHits = new Map();
const ACCOUNT_CONTROL_STATUSES = Object.freeze(['active', 'inactive', 'blocked']);

function assertOtpRateLimit(key) {
  const now = Date.now();
  const entry = otpRequestHits.get(key) || { count: 0, window: now };
  if (now - entry.window > OTP_RATE_LIMIT_MS) {
    entry.count = 0;
    entry.window = now;
  }
  entry.count += 1;
  otpRequestHits.set(key, entry);
  if (entry.count > OTP_RATE_LIMIT_MAX) {
    const err = new Error('Too many OTP requests. Please wait a minute and try again.');
    err.status = 429;
    throw err;
  }
}

const MIN_PASSWORD_LENGTH = 6;

function httpSecurityError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Roles the actor may assign when creating accounts (never developer). */
function assignableRolesForActor(actor) {
  if (isDeveloperRole(actor?.role)) return [...ASSIGNABLE_ROLES];
  return [...CEO_PANEL_ASSIGNABLE_ROLES];
}

function assertActorCanAssignRole(actor, role) {
  const normalized = String(role || '').trim();
  if (normalized === 'developer' || normalized === 'admin') {
    throw httpSecurityError(
      'Cannot assign Platform Developer / User Management Admin (or legacy admin) from Create Account.',
      403
    );
  }
  const allowed = assignableRolesForActor(actor);
  if (!allowed.includes(normalized)) {
    throw httpSecurityError(
      isDeveloperRole(actor?.role)
        ? 'Invalid role. User Management cannot assign this role.'
        : 'Only the Platform Developer (User Management Admin) can create CEO accounts. Choose a lower role.',
      403
    );
  }
  return normalized;
}

function sanitizeManagedPermissions(role, permissions, actor) {
  let finalPermissions = sanitizePermissions(permissions);
  if (!finalPermissions.length) {
    finalPermissions = getDefaultPermissions(role);
  }
  if (role === 'member') return [];
  if (role !== 'cashier') {
    finalPermissions = finalPermissions.filter((key) => !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key));
  }
  // Strict PM isolation: never persist cashier money or CEO payout-review controls on PM accounts.
  if (role === 'project_manager') {
    finalPermissions = finalPermissions.filter(
      (key) => !PROJECT_MANAGER_BLOCKED_PERMISSIONS.includes(key)
    );
  }
  // UM-exclusive grants require Platform Developer actor — CEOs cannot escalate.
  if (!isDeveloperRole(actor?.role)) {
    finalPermissions = finalPermissions.filter((key) => !UM_EXCLUSIVE_PERMISSIONS.includes(key));
  }
  return finalPermissions;
}

async function bumpSessionVersion(userOrId, { save = true } = {}) {
  if (!userOrId) return null;
  if (typeof userOrId === 'object' && userOrId._id) {
    userOrId.sessionVersion = Number(userOrId.sessionVersion || 0) + 1;
    if (save) await userOrId.save();
    return userOrId.sessionVersion;
  }
  await User.updateOne(
    { _id: userOrId },
    { $inc: { sessionVersion: 1 } }
  );
  return true;
}

/**
 * Convert legacy soft-deleted accounts to inactive so financial history stays
 * addressable without a delete lifecycle in User Management.
 */
async function migrateSoftDeletedAccountsToInactive() {
  const result = await User.updateMany(
    { status: 'deleted' },
    {
      $set: { status: 'inactive' },
      $inc: { sessionVersion: 1 },
    }
  );
  return {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
  };
}

async function assertSessionStillValid(sessionUser) {
  if (!sessionUser?.id) {
    return { ok: false, status: 401, error: 'Authentication required.', revoke: true };
  }
  const user = await User.findById(sessionUser.id)
    .select('status role sessionVersion name email permissions preferredLanguage');
  if (!user) {
    return { ok: false, status: 401, error: 'Session invalid. Please sign in again.', revoke: true };
  }
  if (['inactive', 'blocked', 'deleted'].includes(user.status)) {
    return {
      ok: false,
      status: 403,
      error: user.status === 'blocked'
        ? 'Your account is blocked. Please contact User Management.'
        : 'Your account is inactive. Please contact User Management.',
      revoke: true,
    };
  }
  if (Number(sessionUser.sessionVersion || 0) !== Number(user.sessionVersion || 0)) {
    return {
      ok: false,
      status: 401,
      error: 'Your session was revoked. Please sign in again.',
      revoke: true,
    };
  }
  return { ok: true, user };
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOtp() {
  const max = 10 ** OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(OTP_LENGTH, '0');
}

async function recordAudit({
  action,
  category = 'auth',
  actorId = null,
  actorEmail = '',
  actorRole = '',
  targetUserId = null,
  targetEmail = '',
  details = {},
  ip = '',
  success = true,
}) {
  try {
    await SecurityAudit.create({
      action,
      category,
      actorId,
      actorEmail,
      actorRole,
      targetUserId,
      targetEmail,
      details,
      ip,
      success,
    });
  } catch (error) {
    console.warn('Security audit write failed:', error.message);
  }
}

function isTemporarilyLocked(user) {
  if (!user?.lockUntil) return false;
  return new Date(user.lockUntil).getTime() > Date.now();
}

function lockRemainingMs(user) {
  if (!isTemporarilyLocked(user)) return 0;
  return Math.max(0, new Date(user.lockUntil).getTime() - Date.now());
}

function formatLockMessage(user) {
  const hours = Math.ceil(lockRemainingMs(user) / (60 * 60 * 1000));
  return `Account locked due to too many failed login attempts. Try again in about ${hours} hour(s), or request a password reset OTP and contact User Management.`;
}

async function clearExpiredLock(user) {
  if (!user.lockUntil) return user;
  if (new Date(user.lockUntil).getTime() > Date.now()) return user;
  user.lockUntil = null;
  user.failedLoginAttempts = 0;
  await user.save();
  return user;
}

async function registerFailedLogin(user, meta = {}) {
  await clearExpiredLock(user);
  user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
  user.lastFailedLoginAt = new Date();

  let lockedNow = false;
  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    lockedNow = true;
  }

  await user.save();
  await recordAudit({
    action: lockedNow ? 'account_locked' : 'login_failed',
    targetUserId: user._id,
    targetEmail: user.email,
    details: {
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockUntil,
    },
    ip: meta.ip || '',
    success: false,
  });

  return { lockedNow, attempts: user.failedLoginAttempts };
}

async function registerSuccessfulLogin(user, meta = {}) {
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({
    action: 'login_success',
    targetUserId: user._id,
    targetEmail: user.email,
    actorRole: user.role,
    ip: meta.ip || '',
  });
}

function assertCanLogin(user) {
  if (!user) {
    return { ok: false, status: 401, error: 'Invalid credentials.' };
  }
  // Legacy soft-delete treated as inactive — accounts are never removed from UM.
  if (user.status === 'deleted' || user.status === 'inactive') {
    return { ok: false, status: 403, error: 'Your account is inactive. Please contact User Management.' };
  }
  if (user.status === 'blocked') {
    return { ok: false, status: 403, error: 'Your account is blocked. Please contact User Management.' };
  }
  if (isTemporarilyLocked(user)) {
    return { ok: false, status: 423, error: formatLockMessage(user), locked: true };
  }
  return { ok: true };
}

async function requestPasswordOtp(email, meta = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    const err = new Error('Email is required.');
    err.status = 400;
    throw err;
  }

  assertOtpRateLimit(`email:${normalized}`);
  if (meta.ip) {
    assertOtpRateLimit(`ip:${meta.ip}`);
  }

  const user = await User.findOne({ email: normalized });
  const generic = {
    message: 'If an account exists for that email, a one-time password has been sent. Share the OTP with User Management to restore access.',
  };

  if (!user || user.status === 'deleted') {
    return generic;
  }

  const otp = generateOtp();
  user.passwordResetOtpHash = hashValue(otp);
  user.passwordResetOtpExpires = new Date(Date.now() + OTP_TTL_MS);
  user.passwordResetOtpFailCount = 0;
  user.passwordResetRequestedAt = new Date();
  user.passwordResetVerifiedAt = null;
  await user.save();

  const orgName = getOrganizationName('en');
  const subject = `${orgName} password recovery OTP`;
  const text = [
    `Hello ${user.name},`,
    '',
    `Your password recovery OTP is: ${otp}`,
    `This code expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.`,
    '',
    `Share this OTP only with ${orgName} User Management so they can verify your identity and set a new password.`,
    'If you did not request this, ignore this email.',
  ].join('\n');

  const sendResult = await sendTransactionalEmail({
    to: user.email,
    subject,
    text,
    html: `<p>Hello ${user.name},</p><p>Your password recovery OTP is: <strong>${otp}</strong></p><p>This code expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.</p><p>Share this OTP only with ${orgName} User Management to restore access.</p>`,
  });

  if (!sendResult?.sent) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[security] OTP for ${user.email}: ${otp} (email delivery skipped/unavailable)`);
    } else {
      console.warn(`[security] OTP email delivery failed for ${user.email} (code not logged in production)`);
    }
  }

  await recordAudit({
    action: 'password_otp_requested',
    targetUserId: user._id,
    targetEmail: user.email,
    details: { emailSent: Boolean(sendResult?.sent) },
    ip: meta.ip || '',
  });

  return {
    ...generic,
    emailSent: Boolean(sendResult?.sent),
  };
}

async function verifyOtpAndResetPassword({ userId, otp, newPassword, actor, ip }) {
  if (!otp || !newPassword) {
    const err = new Error('OTP and new password are required.');
    err.status = 400;
    throw err;
  }
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    err.status = 400;
    throw err;
  }

  const user = await User.findById(userId).select('+passwordResetOtpHash');
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  if (!user.passwordResetOtpHash || !user.passwordResetOtpExpires) {
    const err = new Error('No active OTP request for this user. Ask them to request a new OTP.');
    err.status = 400;
    throw err;
  }

  if (new Date(user.passwordResetOtpExpires).getTime() < Date.now()) {
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpires = null;
    user.passwordResetOtpFailCount = 0;
    await user.save();
    const err = new Error('OTP has expired. Ask the user to request a new one.');
    err.status = 400;
    throw err;
  }

  if (hashValue(String(otp).trim()) !== user.passwordResetOtpHash) {
    const failCount = Number(user.passwordResetOtpFailCount || 0) + 1;
    const burned = failCount >= OTP_MAX_VERIFY_FAILURES;
    user.passwordResetOtpFailCount = burned ? 0 : failCount;
    if (burned) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpires = null;
    }
    await user.save();
    await recordAudit({
      action: 'password_otp_failed',
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      targetUserId: user._id,
      targetEmail: user.email,
      details: { burned, failCount },
      ip: ip || '',
      success: false,
    });
    throw httpSecurityError(
      burned
        ? 'OTP invalidated after too many failed attempts. Ask the user to request a new OTP.'
        : 'Invalid OTP.',
      400
    );
  }

  // Single-use: clear OTP before persisting the new password.
  user.password = newPassword;
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpires = null;
  user.passwordResetOtpFailCount = 0;
  user.passwordResetVerifiedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.passwordChangedAt = new Date();
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();

  await recordAudit({
    action: 'password_reset_by_developer',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function changeOwnPassword(userId, { currentPassword, newPassword }, meta = {}) {
  if (!currentPassword || !newPassword) {
    const err = new Error('Current password and new password are required.');
    err.status = 400;
    throw err;
  }
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    err.status = 400;
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const valid = await user.comparePassword(currentPassword);
  if (!valid) {
    const err = new Error('Current password is incorrect.');
    err.status = 400;
    throw err;
  }

  user.password = newPassword;
  user.passwordChangedAt = new Date();
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();

  await recordAudit({
    action: 'password_changed_self',
    actorId: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    targetUserId: user._id,
    targetEmail: user.email,
    ip: meta.ip || '',
  });

  return {
    message: 'Password updated successfully.',
    sessionVersion: Number(user.sessionVersion || 0),
  };
}

async function developerSetPassword(userId, newPassword, actor, ip) {
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    err.status = 400;
    throw err;
  }
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  if (isDeveloperRole(user.role) && String(user._id) !== String(actor?.id)) {
    const err = new Error('Cannot change another developer password this way.');
    err.status = 403;
    throw err;
  }

  user.password = newPassword;
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpires = null;
  user.passwordResetOtpFailCount = 0;
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();

  await recordAudit({
    action: 'password_set_by_developer',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function developerUpdateEmail(userId, newEmail, actor, ip) {
  const normalized = String(newEmail || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    const err = new Error('A valid email address is required.');
    err.status = 400;
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const existing = await User.findOne({ email: normalized, _id: { $ne: user._id } });
  if (existing) {
    const err = new Error('That email is already in use by another account.');
    err.status = 409;
    throw err;
  }

  const previousEmail = user.email;
  user.email = normalized;
  await user.save();

  await recordAudit({
    action: 'email_updated_by_developer',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: { previousEmail, newEmail: normalized },
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function developerSetAccountStatus(userId, status, actor, ip) {
  if (!ACCOUNT_CONTROL_STATUSES.includes(status)) {
    throw httpSecurityError('Status must be active, inactive, or blocked. Account deletion is not allowed.');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw httpSecurityError('User not found.', 404);
  }
  // Auto-heal legacy soft-deleted rows into the allowed status set.
  if (user.status === 'deleted') {
    user.status = 'inactive';
  }
  if (isDeveloperRole(user.role) && String(user._id) !== String(actor?.id)) {
    throw httpSecurityError('Cannot change another developer account status.', 403);
  }
  if (String(user._id) === String(actor?.id) && status !== 'active') {
    throw httpSecurityError('You cannot deactivate or block your own developer account.');
  }

  const previous = user.status;
  user.status = status;
  if (status === 'active') {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
  } else {
    // Instantly invalidate any active sessions for inactive/blocked accounts.
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  }
  await user.save();

  await recordAudit({
    action: 'account_status_changed',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: { previous, status, sessionRevoked: status !== 'active' },
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function developerUnlockAccount(userId, actor, ip) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  await recordAudit({
    action: 'account_unlocked',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function createManagedUser({
  name,
  email,
  password,
  role,
  permissions,
}, actor, ip) {
  if (!name || !email || !password || !role) {
    throw httpSecurityError('Name, email, password, and role are required.');
  }
  const normalizedRole = assertActorCanAssignRole(actor, role);
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw httpSecurityError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw httpSecurityError('Enter a valid email address.');
  }
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw httpSecurityError('A user with this email already exists.', 409);
  }

  const finalPermissions = sanitizeManagedPermissions(normalizedRole, permissions, actor);

  const user = await User.create({
    name: String(name).trim().slice(0, 120),
    email: normalizedEmail,
    password,
    role: normalizedRole,
    permissions: finalPermissions,
    savings: 0,
    profit: 0,
    advanceBalance: 0,
    status: 'active',
    sessionVersion: 0,
  });

  await recordAudit({
    action: 'user_created_by_user_management',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: { role: normalizedRole, status: user.status },
    ip: ip || '',
  });

  const fresh = await User.findById(user._id);
  return {
    user: sanitizeUserForDeveloper(fresh),
    message: normalizedRole === 'member'
      ? 'Member account created and is active. They can log in with the temporary password.'
      : 'Account created in User Management.',
  };
}

/** @deprecated Soft-delete removed — use active / inactive / blocked. */
async function softDeleteUser() {
  throw httpSecurityError(
    'Account deletion is disabled. Set the account to inactive or blocked instead so financial history stays intact.',
    410
  );
}

/** @deprecated Soft-delete removed — activate via status controls. */
async function restoreSoftDeletedUser(userId, actor, ip) {
  await migrateSoftDeletedAccountsToInactive();
  return developerSetAccountStatus(userId, 'active', actor, ip);
}

function sanitizeUserForDeveloper(user) {
  const obj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.passwordResetOtpHash;
  return {
    id: obj._id,
    _id: obj._id,
    name: obj.name,
    email: obj.email,
    role: obj.role,
    roleLabel: ROLE_LABELS[obj.role] || obj.role,
    status: obj.status,
    permissions: obj.permissions || [],
    savings: obj.savings,
    profit: obj.profit,
    advanceBalance: obj.advanceBalance || 0,
    pendingEntryBuyIn: Boolean(obj.pendingEntryBuyIn),
    shareEntryAmount: Number(obj.shareEntryAmount || obj.requiredEntryAmount || 0),
    requiredEntryAmount: Number(obj.requiredEntryAmount || 0),
    membershipSubmittedAt: obj.membershipSubmittedAt || null,
    ceoApprovedAt: obj.ceoApprovedAt || null,
    ceoApprovedBy: obj.ceoApprovedBy || '',
    entryBuyInPaidAt: obj.entryBuyInPaidAt || null,
    phone: obj.phone || '',
    failedLoginAttempts: obj.failedLoginAttempts || 0,
    lockUntil: obj.lockUntil || null,
    isTemporarilyLocked: isTemporarilyLocked(obj),
    lastFailedLoginAt: obj.lastFailedLoginAt || null,
    lastLoginAt: obj.lastLoginAt || null,
    passwordChangedAt: obj.passwordChangedAt || null,
    passwordResetRequestedAt: obj.passwordResetRequestedAt || null,
    passwordResetVerifiedAt: obj.passwordResetVerifiedAt || null,
    hasPendingOtp: Boolean(
      obj.passwordResetOtpExpires
      && new Date(obj.passwordResetOtpExpires).getTime() > Date.now()
    ),
    deletedAt: obj.deletedAt || null,
    deletedReason: obj.deletedReason || '',
    deletedBy: obj.deletedBy || '',
    restoredAt: obj.restoredAt || null,
    createdAt: obj.createdAt,
  };
}

async function listUsersForDeveloper({ q = '', role = '', status = '' } = {}) {
  await migrateSoftDeletedAccountsToInactive();

  const filter = {};
  if (role) filter.role = role;
  if (status) {
    if (status === 'deleted') {
      // Deleted filter retired — surface inactive accounts instead.
      filter.status = 'inactive';
    } else {
      filter.status = status;
    }
  }
  if (q) {
    const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }

  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500);
  return users.map(sanitizeUserForDeveloper);
}

async function getDeveloperDashboardStats() {
  await migrateSoftDeletedAccountsToInactive();

  const [
    total,
    active,
    inactive,
    blocked,
    locked,
    pendingOtp,
    byRole,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'inactive' }),
    User.countDocuments({ status: 'blocked' }),
    User.countDocuments({ lockUntil: { $gt: new Date() } }),
    User.countDocuments({
      passwordResetOtpExpires: { $gt: new Date() },
      passwordResetOtpHash: { $ne: null },
    }),
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    total,
    active,
    inactive,
    blocked,
    deleted: 0,
    locked,
    pendingOtp,
    byRole: byRole.reduce((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {}),
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    lockDurationHours: LOCK_DURATION_MS / (60 * 60 * 1000),
    otpTtlMinutes: Math.round(OTP_TTL_MS / 60000),
  };
}

async function listRecentSecurityAudits(limit = 50) {
  return SecurityAudit.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();
}

async function verifyUserPassword(userId, password) {
  if (!password) return false;
  const user = await User.findById(userId);
  if (!user) return false;
  return user.comparePassword(password);
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || '';
}

function rolesRequiringPasswordConfirm(role) {
  // Any staff role that can reach money/member mutation routes must re-confirm.
  return ['ceo', 'admin', 'project_manager', 'cashier', 'employee', 'investor'].includes(role)
    || isFullAccessRole(role);
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  OTP_TTL_MS,
  OTP_MAX_VERIFY_FAILURES,
  MIN_PASSWORD_LENGTH,
  ACCOUNT_CONTROL_STATUSES,
  hashValue,
  generateOtp,
  recordAudit,
  isTemporarilyLocked,
  clearExpiredLock,
  registerFailedLogin,
  registerSuccessfulLogin,
  assertCanLogin,
  assertSessionStillValid,
  assertActorCanAssignRole,
  assignableRolesForActor,
  sanitizeManagedPermissions,
  bumpSessionVersion,
  migrateSoftDeletedAccountsToInactive,
  requestPasswordOtp,
  verifyOtpAndResetPassword,
  changeOwnPassword,
  developerSetPassword,
  developerUpdateEmail,
  developerSetAccountStatus,
  developerUnlockAccount,
  createManagedUser,
  softDeleteUser,
  restoreSoftDeletedUser,
  sanitizeUserForDeveloper,
  listUsersForDeveloper,
  getDeveloperDashboardStats,
  listRecentSecurityAudits,
  verifyUserPassword,
  clientIp,
  rolesRequiringPasswordConfirm,
};
