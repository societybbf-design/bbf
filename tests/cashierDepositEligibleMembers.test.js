'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCashierDepositEligibility,
} = require('../services/monthlyTargetService');

const monthlyTargetJs = fs.readFileSync(path.join(__dirname, '../services/monthlyTargetService.js'), 'utf8');
const adminDepositsJs = fs.readFileSync(path.join(__dirname, '../routes/adminDeposits.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('evaluateCashierDepositEligibility excludes fully paid current month without arrears', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 0,
    previousUnpaidCount: 0,
    advanceBalance: 0,
    requiredAmount: 50000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'current_month_paid');
});

test('evaluateCashierDepositEligibility excludes advance-covered members without arrears', () => {
  const covered = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    advanceBalance: 50000,
    requiredAmount: 50000,
  });
  assert.equal(covered.eligible, false);
  assert.equal(covered.reason, 'advance_covers_target');

  const overCovered = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    advanceBalance: 75000,
    requiredAmount: 50000,
  });
  assert.equal(overCovered.eligible, false);
});

test('evaluateCashierDepositEligibility includes unpaid with low advance', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    advanceBalance: 10000,
    requiredAmount: 50000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'needs_manual_deposit');
});

test('evaluateCashierDepositEligibility includes prior arrears even when advance covers target', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 0,
    previousUnpaidCount: 2,
    advanceBalance: 100000,
    requiredAmount: 50000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'prior_arrears');
});

test('eligible-members route and deposit dropdown wiring exist', () => {
  assert.match(monthlyTargetJs, /async function listCashierDepositEligibleMembers/);
  assert.match(monthlyTargetJs, /function evaluateCashierDepositEligibility/);
  assert.match(adminDepositsJs, /\/eligible-members/);
  assert.match(adminDepositsJs, /listCashierDepositEligibleMembers/);
  assert.match(adminDepositsJs, /requireCashierRole/);
  // Static path must be registered before /:id/receipt.
  const eligibleIdx = adminDepositsJs.indexOf("router.get('/eligible-members'");
  const receiptIdx = adminDepositsJs.indexOf("router.get('/:id/receipt'");
  assert.ok(eligibleIdx >= 0 && eligibleIdx < receiptIdx);
  assert.match(staffJs, /function ensureDepositEligibleMemberOptions/);
  assert.match(staffJs, /\/api\/admin\/deposits\/eligible-members/);
  assert.match(staffJs, /ensureDepositEligibleMemberOptions\(\)/);
  assert.match(staffJs, /cashierAdvanceMember/);
});
