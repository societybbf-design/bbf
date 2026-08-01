'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const security = require('../services/securityService');
const { assignableRolesForActor, sanitizeManagedPermissions, ACCOUNT_CONTROL_STATUSES } = security;
const { CEO_PANEL_ASSIGNABLE_ROLES, ASSIGNABLE_ROLES } = require('../services/rbac');
const { loginRateLimit, umCreateRateLimit, createRateLimiter } = require('../services/requestRateLimit');

const securityJs = fs.readFileSync(path.join(__dirname, '../services/securityService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/developer.js'), 'utf8');
const authJs = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
const authMw = fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8');
const memberAccessJs = fs.readFileSync(path.join(__dirname, '../middleware/memberAccess.js'), 'utf8');
const developerJs = fs.readFileSync(path.join(__dirname, '../public/js/developer.js'), 'utf8');
const umHtml = fs.readFileSync(path.join(__dirname, '../views/user-management.html'), 'utf8');
const userModelJs = fs.readFileSync(path.join(__dirname, '../models/User.js'), 'utf8');
const exitJs = fs.readFileSync(path.join(__dirname, '../services/memberExitService.js'), 'utf8');

test('account control statuses are active/inactive/blocked only', () => {
  assert.deepEqual([...ACCOUNT_CONTROL_STATUSES], ['active', 'inactive', 'blocked']);
  assert.match(securityJs, /Status must be active, inactive, or blocked/);
  assert.match(securityJs, /Account deletion is disabled/);
});

test('soft-delete routes return gone and UI no longer exposes delete controls', () => {
  assert.match(routesJs, /softDeleteEnabled:\s*false/);
  assert.match(routesJs, /status\(410\)/);
  assert.doesNotMatch(developerJs, /data-action="soft-delete"/);
  assert.doesNotMatch(developerJs, /openDeletionSettlementModal/);
  assert.doesNotMatch(developerJs, /bindDeletionSettlementModal/);
  assert.doesNotMatch(umHtml, /devDeleteSettleModal/);
  assert.doesNotMatch(umHtml, /value="deleted"/);
  assert.match(umHtml, /never deleted/i);
});

test('createManagedUser blocks developer role and CEO escalation for non-developers', () => {
  assert.deepEqual(assignableRolesForActor({ role: 'developer' }), [...ASSIGNABLE_ROLES]);
  assert.deepEqual(assignableRolesForActor({ role: 'ceo' }), [...CEO_PANEL_ASSIGNABLE_ROLES]);
  assert.ok(!assignableRolesForActor({ role: 'ceo' }).includes('ceo'));

  assert.throws(
    () => security.assertActorCanAssignRole({ role: 'ceo' }, 'ceo'),
    (err) => err.status === 403
  );
  assert.throws(
    () => security.assertActorCanAssignRole({ role: 'developer' }, 'developer'),
    (err) => err.status === 403
  );

  const ceoPerms = sanitizeManagedPermissions('cashier', ['can_manage_security', 'can_manage_deposits'], { role: 'ceo' });
  assert.ok(!ceoPerms.includes('can_manage_security'));
  assert.ok(ceoPerms.includes('can_manage_deposits'));
});

test('OTP has strict TTL, fail burn, and single-use clear', () => {
  assert.equal(security.OTP_TTL_MS <= 30 * 60 * 1000, true);
  assert.match(securityJs, /OTP_MAX_VERIFY_FAILURES/);
  assert.match(securityJs, /OTP invalidated after too many failed attempts/);
  assert.match(securityJs, /passwordResetOtpHash = null/);
  assert.match(securityJs, /Single-use/);
});

test('sessionVersion revocation on inactive/blocked and requireAuth live check', () => {
  assert.match(userModelJs, /sessionVersion/);
  assert.match(securityJs, /sessionVersion/);
  assert.match(securityJs, /assertSessionStillValid/);
  assert.match(authMw, /assertSessionStillValid/);
  assert.match(authJs, /sessionVersion/);
  assert.match(memberAccessJs, /status === 'blocked'/);
});

test('rate limiting covers login and UM mutating routes', () => {
  assert.equal(typeof loginRateLimit.middleware, 'function');
  assert.equal(typeof umCreateRateLimit.middleware, 'function');
  assert.match(authJs, /loginRateLimit\.middleware\(\)/);
  assert.match(routesJs, /umCreateRateLimit\.middleware\(\)/);
  assert.match(routesJs, /umMutateRateLimit\.middleware\(\)/);
  assert.match(routesJs, /otpVerifyRateLimit\.middleware\(\)/);

  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, message: 'slow down' });
  limiter.assert('k');
  limiter.assert('k');
  assert.throws(() => limiter.assert('k'), (err) => err.status === 429);
});

test('member exit closes access as inactive instead of deleted', () => {
  assert.match(exitJs, /member\.status = 'inactive'/);
  assert.match(exitJs, /sessionVersion/);
  assert.doesNotMatch(exitJs, /member\.status = 'deleted'/);
});

test('legacy soft-deleted accounts are migrated to inactive', () => {
  assert.equal(typeof security.migrateSoftDeletedAccountsToInactive, 'function');
  assert.match(securityJs, /migrateSoftDeletedAccountsToInactive/);
});

test('UM overview no longer surfaces soft-deleted KPI', () => {
  assert.doesNotMatch(developerJs, /Soft-deleted/);
  assert.match(developerJs, /\['Blocked', stats\.blocked\]/);
});
