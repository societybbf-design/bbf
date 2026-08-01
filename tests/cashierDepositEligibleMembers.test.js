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
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');

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

test('strict rule hides when advance covers current target + prior dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 5000,
    previousUnpaidCount: 1,
    previousUnpaidTotal: 5000,
    advanceBalance: 98750,
    requiredAmount: 5000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'advance_covers_dues');
  assert.equal(result.coverageNeed, 10000);
});

test('strict rule hides when advance equals exact current target + prior dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 54000,
    previousUnpaidCount: 1,
    previousUnpaidTotal: 20000,
    advanceBalance: 74000,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, false);
  assert.ok(['advance_covers_target', 'advance_covers_dues'].includes(result.reason));
});

test('evaluateCashierDepositEligibility keeps members when advance cannot cover total obligation', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 54000,
    previousUnpaidCount: 2,
    previousUnpaidTotal: 100000,
    advanceBalance: 60000,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'prior_arrears');
  // Obligation uses full current target + prior (154000), not merely remaining.
  assert.equal(result.totalObligation, 154000);
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

test('partial current unpaid still hides when advance covers remaining dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 2000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 5000,
    requiredAmount: 5000,
  });
  // Strict product formula uses full current target (5000); advance 5000 covers it.
  assert.equal(result.eligible, false);
});

test('eligible-members list syncs dues and applies advance coverage filter', () => {
  assert.match(monthlyTargetJs, /async function listCashierDepositEligibleMembers/);
  assert.match(monthlyTargetJs, /function evaluateCashierDepositEligibility/);
  assert.match(monthlyTargetJs, /await syncMonthDues\(yearMonth/);
  assert.match(monthlyTargetJs, /currentTargetComponent/);
  assert.match(monthlyTargetJs, /coverageNeed/);
  assert.match(monthlyTargetJs, /Advance Balance is less than current target \+ prior dues/);
  assert.match(adminDepositsJs, /\/eligible-members/);
  assert.match(adminDepositsJs, /listCashierDepositEligibleMembers/);
  assert.match(adminDepositsJs, /requireCashierRole/);
  const eligibleIdx = adminDepositsJs.indexOf("router.get('/eligible-members'");
  const receiptIdx = adminDepositsJs.indexOf("router.get('/:id/receipt'");
  assert.ok(eligibleIdx >= 0 && eligibleIdx < receiptIdx);
  assert.match(staffJs, /function ensureDepositEligibleMemberOptions/);
  assert.match(staffJs, /\/api\/admin\/deposits\/eligible-members/);
  assert.match(staffJs, /ensureDepositEligibleMemberOptions\(\)/);
  assert.match(staffHtml, /Members whose advance already covers/);
});
