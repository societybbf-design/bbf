'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateWithdrawalAvailability,
} = require('../services/withdrawalService');
const {
  CASHIER_EXCLUSIVE_PERMISSIONS,
  getDefaultPermissions,
  publicUserPayload,
  userHasPermission,
} = require('../services/rbac');

const root = path.join(__dirname, '..');
const serviceJs = fs.readFileSync(path.join(root, 'services/withdrawalService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(root, 'routes/withdrawals.js'), 'utf8');
const inboxJs = fs.readFileSync(path.join(root, 'services/approvalsInboxService.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(root, 'views/member.html'), 'utf8');
const memberJs = fs.readFileSync(path.join(root, 'public/js/member.js'), 'utf8');

test('calculateWithdrawalAvailability uses advance balance (not savings)', () => {
  const result = calculateWithdrawalAvailability({
    advanceBalance: 2500,
    pendingAmount: 400,
    requestedAmount: 900,
  });

  assert.equal(result.availableAmount, 2100);
  assert.equal(result.canRequest, true);
  assert.equal(result.remainingAfterRequest, 1200);
  assert.equal(result.advanceBalance, 2500);
});

test('calculateWithdrawalAvailability blocks requests above remaining advance', () => {
  const result = calculateWithdrawalAvailability({
    advanceBalance: 500,
    pendingAmount: 300,
    requestedAmount: 400,
  });

  assert.equal(result.availableAmount, 200);
  assert.equal(result.canRequest, false);
  assert.equal(result.remainingAfterRequest, -200);
});

test('legacy savings alias still works for availability helper', () => {
  const result = calculateWithdrawalAvailability({
    savings: 1000,
    pendingAmount: 0,
    requestedAmount: 250,
  });
  assert.equal(result.availableAmount, 1000);
  assert.equal(result.canRequest, true);
});

test('service pays from advanceBalance and never deducts savings', () => {
  assert.match(serviceJs, /member\.advanceBalance/);
  assert.match(serviceJs, /paidFrom:\s*'advanceBalance'/);
  assert.doesNotMatch(serviceJs, /member\.savings\s*=\s*Math\.max/);
  assert.match(serviceJs, /Insufficient Advance Balance/);
  assert.match(serviceJs, /cannot be paid from savings/i);
});

test('CEO approve then cashier process transitions are enforced', () => {
  assert.match(serviceJs, /async function approveWithdrawal/);
  assert.match(serviceJs, /async function processWithdrawalPayout/);
  assert.match(serviceJs, /Only pending withdrawal requests can be approved/);
  assert.match(serviceJs, /must be approved by the CEO before the Cashier/);
  assert.match(routesJs, /\/admin\/:id\/approve/);
  assert.match(routesJs, /\/admin\/:id\/cashier-complete/);
  assert.match(routesJs, /requireCashierRole/);
  assert.match(routesJs, /can_disburse_withdrawals/);
});

test('can_disburse_withdrawals is cashier-exclusive; CEO keeps review only', () => {
  assert.ok(CASHIER_EXCLUSIVE_PERMISSIONS.includes('can_disburse_withdrawals'));
  assert.equal(userHasPermission({ role: 'cashier', permissions: [] }, 'can_disburse_withdrawals'), true);
  assert.equal(userHasPermission({ role: 'ceo', permissions: ['can_disburse_withdrawals'] }, 'can_disburse_withdrawals'), false);
  assert.equal(getDefaultPermissions('ceo').includes('can_disburse_withdrawals'), false);
  assert.equal(getDefaultPermissions('ceo').includes('can_manage_withdrawals'), true);
  assert.equal(getDefaultPermissions('cashier').includes('can_disburse_withdrawals'), true);
  assert.equal(getDefaultPermissions('cashier').includes('can_manage_withdrawals'), false);

  const cashierPayload = publicUserPayload({
    _id: 'w1',
    email: 'cashier-w@example.com',
    role: 'cashier',
    name: 'Cashier',
    permissions: ['can_manage_deposits', 'can_manage_withdrawals'],
  });
  assert.equal(cashierPayload.permissions.includes('can_disburse_withdrawals'), true);
  assert.equal(cashierPayload.permissions.includes('can_manage_withdrawals'), false);

  const ceoPayload = publicUserPayload({
    _id: 'w2',
    email: 'ceo-w@example.com',
    role: 'ceo',
    name: 'CEO',
    permissions: ['can_disburse_withdrawals', 'can_manage_withdrawals'],
  });
  assert.equal(ceoPayload.permissions.includes('can_disburse_withdrawals'), false);
  assert.equal(ceoPayload.permissions.includes('can_manage_withdrawals'), true);
});

test('approvals inbox splits CEO review and cashier advance payout', () => {
  assert.match(inboxJs, /can_manage_withdrawals[\s\S]*!isCashier/);
  assert.match(inboxJs, /can_disburse_withdrawals[\s\S]*isCashier/);
  assert.match(inboxJs, /Pay from Advance/);
  assert.match(inboxJs, /cashier-complete/);
});

test('dashboards enforce CEO approve and cashier advance-only payout UI', () => {
  assert.match(adminJs, /Approve → Cashier/);
  assert.match(adminJs, /\/approve/);
  assert.doesNotMatch(adminJs, /data-action="process"/);
  assert.match(staffJs, /can_disburse_withdrawals/);
  assert.match(staffJs, /cashier-queue/);
  assert.match(staffJs, /Pay from Advance/);
  assert.match(staffJs, /Cannot pay from savings/);
  assert.match(memberHtml, /withdrawalAdvanceAvailable/);
  assert.match(memberHtml, /Advance Balance/);
  assert.match(memberJs, /refreshWithdrawalAdvanceHint/);
});
