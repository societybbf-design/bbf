'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDefaultPermissions,
  CASHIER_EXCLUSIVE_PERMISSIONS,
  PROJECT_MANAGER_BLOCKED_PERMISSIONS,
  publicUserPayload,
  userHasPermission,
} = require('../services/rbac');
const { sanitizeManagedPermissions } = require('../services/securityService');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const investmentsJs = fs.readFileSync(path.join(__dirname, '../routes/investments.js'), 'utf8');
const trackingMw = fs.readFileSync(path.join(__dirname, '../middleware/cashierTrackingAccess.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const developerJs = fs.readFileSync(path.join(__dirname, '../public/js/developer.js'), 'utf8');

test('project manager defaults exclude cashier-exclusive and blocked finance controls', () => {
  const pm = getDefaultPermissions('project_manager');
  for (const key of CASHIER_EXCLUSIVE_PERMISSIONS) {
    assert.equal(pm.includes(key), false, `PM default must not include ${key}`);
  }
  for (const key of PROJECT_MANAGER_BLOCKED_PERMISSIONS) {
    assert.equal(pm.includes(key), false, `PM default must not include ${key}`);
  }
  assert.ok(pm.includes('can_manage_investments'));
  assert.ok(pm.includes('can_manage_members'));
});

test('sanitizeManagedPermissions strips cashier and PM-blocked grants from project_manager', () => {
  const mixed = [
    'can_manage_members',
    'can_manage_investments',
    'can_manage_deposits',
    'can_disburse_loans',
    'can_manage_profit',
    'can_manage_withdrawals',
    'can_manage_refunds',
  ];
  const cleaned = sanitizeManagedPermissions('project_manager', mixed, { role: 'developer' });
  assert.deepEqual(
    cleaned.sort(),
    ['can_manage_investments', 'can_manage_members'].sort()
  );
  assert.ok(!cleaned.some((key) => CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)));
  assert.ok(!cleaned.some((key) => PROJECT_MANAGER_BLOCKED_PERMISSIONS.includes(key)));
});

test('publicUserPayload never exposes cashier payout perms to project_manager', () => {
  const payload = publicUserPayload({
    _id: 'pm1',
    email: 'pm@example.com',
    name: 'PM',
    role: 'project_manager',
    permissions: [
      'can_manage_members',
      'can_manage_investments',
      'can_manage_deposits',
      'can_manage_profit',
      'can_disburse_withdrawals',
    ],
  });
  assert.equal(payload.redirectTo, '/dashboard/project-manager');
  assert.ok(!payload.permissions.includes('can_manage_deposits'));
  assert.ok(!payload.permissions.includes('can_manage_profit'));
  assert.ok(!payload.permissions.includes('can_disburse_withdrawals'));
  assert.equal(userHasPermission(payload, 'can_manage_deposits'), false);
  assert.equal(userHasPermission(payload, 'can_disburse_loans'), false);
});

test('staff dashboard hard-isolates cashier panels and branding for non-cashiers', () => {
  assert.match(staffJs, /const CASHIER_ONLY_VIEWS/);
  assert.match(staffJs, /function applyStaffRoleChrome/);
  assert.match(staffJs, /function isCashierRole/);
  assert.match(staffJs, /!isCashierRole\(\) && CASHIER_ONLY_VIEWS\.has\(next\)/);
  assert.match(staffJs, /applyStaffRoleChrome\(user\)/);
  assert.match(staffJs, /user\.role !== 'project_manager'/);
  assert.match(staffJs, /Your project manager workspace/);
  assert.match(staffHtml, /data-non-cashier-home/);
  assert.match(staffHtml, /data-cashier-home-only/);
  assert.doesNotMatch(staffHtml, /data-brand-portal="cashier"/);
});

test('investment cashier money routes require cashier role, not can_manage_investments', () => {
  assert.match(investmentsJs, /function requireCashierRole/);
  assert.match(investmentsJs, /cashierMoney/);
  assert.match(investmentsJs, /router\.get\('\/cashier-queue', \.\.\.cashierMoney/);
  assert.match(investmentsJs, /router\.post\('\/:id\/cashier-complete', \.\.\.cashierMoney/);
  assert.doesNotMatch(
    investmentsJs,
    /cashier-queue', requirePermission\('can_manage_deposits', 'can_manage_investments'\)/
  );
});

test('cashier tracking middleware excludes project_manager', () => {
  assert.match(trackingMw, /STAFF_TRANSPARENCY_ROLES/);
  assert.doesNotMatch(trackingMw, /'project_manager'/);
  assert.match(trackingMw, /'employee'/);
});

test('UM permission picker blocks cashier grants for non-cashier roles', () => {
  assert.match(developerJs, /umBlockedPermissionsForRole/);
  assert.match(developerJs, /projectManagerBlockedPermissions/);
  assert.match(developerJs, /isBlocked \? 'disabled'/);
});
