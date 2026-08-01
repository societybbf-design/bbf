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
    previousUnpaidTotal: 0,
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
    previousUnpaidTotal: 0,
    advanceBalance: 50000,
    requiredAmount: 50000,
  });
  assert.equal(covered.eligible, false);
  assert.equal(covered.reason, 'advance_covers_target');

  const overCovered = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 75000,
    requiredAmount: 50000,
  });
  assert.equal(overCovered.eligible, false);
});

test('evaluateCashierDepositEligibility includes unpaid with low advance', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 10000,
    requiredAmount: 50000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'needs_manual_deposit');
});

test('evaluateCashierDepositEligibility hides members when advance covers total dues including arrears', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 54000,
    previousUnpaidCount: 1,
    previousUnpaidTotal: 20000,
    advanceBalance: 80750,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, false);
  assert.ok(['advance_covers_target', 'advance_covers_dues'].includes(result.reason));
});

test('evaluateCashierDepositEligibility keeps prior arrears when advance cannot cover total dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 54000,
    previousUnpaidCount: 2,
    previousUnpaidTotal: 100000,
    advanceBalance: 60000,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'prior_arrears');
});

test('evaluateCashierDepositEligibility hides cleared dues even if prior count is stale', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 0,
    previousUnpaidCount: 1,
    previousUnpaidTotal: 0,
    advanceBalance: 80750,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, false);
});

test('eligible-members route and deposit dropdown wiring exist', () => {
  assert.match(monthlyTargetJs, /async function listCashierDepositEligibleMembers/);
  assert.match(monthlyTargetJs, /function evaluateCashierDepositEligibility/);
  assert.match(monthlyTargetJs, /previousUnpaidTotal/);
  assert.match(monthlyTargetJs, /insufficient Advance Balance/);
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
