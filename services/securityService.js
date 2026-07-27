const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SecurityAudit = require('../models/SecurityAudit');
const { sendTransactionalEmail } = require('./notificationService');
const { ROLE_LABELS, isDeveloperRole, isFullAccessRole, ASSIGNABLE_ROLES, getDefaultPermissions, sanitizePermissions } = require('./rbac');

const MAX_FAILED_ATTEMPTS = Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
const LOCK_DURATION_MS = Number(process.env.ACCOUNT_LOCK_MS) || 24 * 60 * 60 * 1000;
const OTP_TTL_MS = Number(process.env.PASSWORD_OTP_TTL_MS) || 30 * 60 * 1000;
const OTP_LENGTH = 6;
const OTP_RATE_LIMIT_MS = Number(process.env.PASSWORD_OTP_RATE_LIMIT_MS) || 60 * 1000;
const OTP_RATE_LIMIT_MAX = Number(process.env.PASSWORD_OTP_RATE_LIMIT_MAX) || 3;
const otpRequestHits = new Map();

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
  if (user.status === 'deleted') {
    return { ok: false, status: 403, error: 'Your account has been removed. Please contact User Management.' };
  }
  if (user.status === 'inactive') {
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
  user.passwordResetRequestedAt = new Date();
  user.passwordResetVerifiedAt = null;
  await user.save();

  const subject = 'SocietyHub password recovery OTP';
  const text = [
    `Hello ${user.name},`,
    '',
    `Your password recovery OTP is: ${otp}`,
    `This code expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.`,
    '',
    'Share this OTP only with SocietyHub User Management so they can verify your identity and set a new password.',
    'If you did not request this, ignore this email.',
  ].join('\n');

  const sendResult = await sendTransactionalEmail({
    to: user.email,
    subject,
    text,
    html: `<p>Hello ${user.name},</p><p>Your password recovery OTP is: <strong>${otp}</strong></p><p>This code expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.</p><p>Share this OTP only with SocietyHub User Management to restore access.</p>`,
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
    const err = new Error('OTP has expired. Ask the user to request a new one.');
    err.status = 400;
    throw err;
  }

  if (hashValue(otp) !== user.passwordResetOtpHash) {
    await recordAudit({
      action: 'password_otp_failed',
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      targetUserId: user._id,
      targetEmail: user.email,
      ip: ip || '',
      success: false,
    });
    const err = new Error('Invalid OTP.');
    err.status = 400;
    throw err;
  }

  user.password = newPassword;
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpires = null;
  user.passwordResetVerifiedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  if (user.status === 'blocked') {
    // Unlock temporary lock only; blocked stays blocked unless developer unblocks
  }
  user.passwordChangedAt = new Date();
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

  return { message: 'Password updated successfully.' };
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
  const allowed = new Set(['active', 'inactive', 'blocked']);
  if (!allowed.has(status)) {
    const err = new Error('Status must be active, inactive, or blocked. Use soft-delete to remove an account.');
    err.status = 400;
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  if (user.status === 'deleted') {
    const err = new Error('Account is soft-deleted. Restore it before changing status.');
    err.status = 400;
    throw err;
  }
  if (isDeveloperRole(user.role) && String(user._id) !== String(actor?.id)) {
    const err = new Error('Cannot change another developer account status.');
    err.status = 403;
    throw err;
  }
  if (String(user._id) === String(actor?.id) && status !== 'active') {
    const err = new Error('You cannot deactivate or block your own developer account.');
    err.status = 400;
    throw err;
  }

  const previous = user.status;
  user.status = status;
  if (status === 'active') {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
  }
  await user.save();

  await recordAudit({
    action: 'account_status_changed',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: { previous, status },
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
  entryAmountPaid,
}, actor, ip) {
  if (!name || !email || !password || !role) {
    const err = new Error('Name, email, password, and role are required.');
    err.status = 400;
    throw err;
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    const err = new Error('Invalid role. User Management cannot assign this role.');
    err.status = 400;
    throw err;
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    err.status = 400;
    throw err;
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    const err = new Error('A user with this email already exists.');
    err.status = 409;
    throw err;
  }

  let finalPermissions = sanitizePermissions(permissions);
  if (!finalPermissions.length) {
    finalPermissions = getDefaultPermissions(role);
  }
  if (role === 'member') {
    finalPermissions = [];
  }

  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    password,
    role,
    permissions: finalPermissions,
    savings: 0,
    profit: 0,
    advanceBalance: 0,
    status: 'active',
  });

  let buyInResult = null;
  if (role === 'member') {
    try {
      const { prepareMemberForBuyIn } = require('./memberMigrationService');
      buyInResult = await prepareMemberForBuyIn(user, {
        entryAmountPaid,
        recordedBy: actor?.name || actor?.email || 'User Management',
      });
    } catch (buyInError) {
      await User.findByIdAndDelete(user._id);
      throw buyInError;
    }
  }

  await recordAudit({
    action: 'user_created_by_user_management',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: {
      role,
      pendingEntryBuyIn: Boolean(buyInResult && !buyInResult.activated),
      requiredEntryAmount: buyInResult?.valuation?.entryAmount,
    },
    ip: ip || '',
  });

  const fresh = await User.findById(user._id);
  return {
    user: sanitizeUserForDeveloper(fresh),
    valuation: buyInResult?.valuation || null,
    buyIn: buyInResult?.buyIn || null,
    activated: buyInResult ? buyInResult.activated : true,
    message: buyInResult?.message
      || 'Account created in User Management. Financial data starts clean for this account.',
  };
}

async function softDeleteUser(userId, { reason = '', deletedBy = '' } = {}, actor, ip) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  if (user.status === 'deleted') {
    const err = new Error('Account is already soft-deleted.');
    err.status = 400;
    throw err;
  }
  if (isDeveloperRole(user.role)) {
    const err = new Error('User Management admin accounts cannot be soft-deleted.');
    err.status = 403;
    throw err;
  }
  if (String(user._id) === String(actor?.id)) {
    const err = new Error('You cannot soft-delete your own account.');
    err.status = 400;
    throw err;
  }

  const previous = user.status;
  user.status = 'deleted';
  user.deletedAt = new Date();
  user.deletedReason = String(reason || 'Soft-deleted via User Management').trim();
  user.deletedBy = String(deletedBy || actor?.name || actor?.email || 'User Management').trim();
  user.restoredAt = null;
  await user.save();

  await recordAudit({
    action: 'account_soft_deleted',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    details: { previous, reason: user.deletedReason },
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
}

async function restoreSoftDeletedUser(userId, actor, ip) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  if (user.status !== 'deleted') {
    const err = new Error('Only soft-deleted accounts can be restored.');
    err.status = 400;
    throw err;
  }

  user.status = 'active';
  user.restoredAt = new Date();
  user.deletedAt = null;
  user.deletedReason = '';
  user.deletedBy = '';
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  await recordAudit({
    action: 'account_restored',
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    targetUserId: user._id,
    targetEmail: user.email,
    ip: ip || '',
  });

  return sanitizeUserForDeveloper(user);
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
    requiredEntryAmount: Number(obj.requiredEntryAmount || 0),
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
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
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
  const [
    total,
    active,
    inactive,
    blocked,
    deleted,
    locked,
    pendingOtp,
    byRole,
  ] = await Promise.all([
    User.countDocuments({ status: { $ne: 'deleted' } }),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'inactive' }),
    User.countDocuments({ status: 'blocked' }),
    User.countDocuments({ status: 'deleted' }),
    User.countDocuments({ lockUntil: { $gt: new Date() } }),
    User.countDocuments({
      passwordResetOtpExpires: { $gt: new Date() },
      passwordResetOtpHash: { $ne: null },
    }),
    User.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    total,
    active,
    inactive,
    blocked,
    deleted,
    locked,
    pendingOtp,
    byRole: byRole.reduce((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {}),
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    lockDurationHours: LOCK_DURATION_MS / (60 * 60 * 1000),
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
  MIN_PASSWORD_LENGTH,
  hashValue,
  generateOtp,
  recordAudit,
  isTemporarilyLocked,
  clearExpiredLock,
  registerFailedLogin,
  registerSuccessfulLogin,
  assertCanLogin,
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
