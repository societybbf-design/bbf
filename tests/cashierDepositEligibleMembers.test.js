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

test('evaluateCashierDepositEligibility excludes zero remaining dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 0,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 0,
    requiredAmount: 50000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no_outstanding_dues');
});

test('stale prior count with zero prior total is hidden', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 0,
    previousUnpaidCount: 1,
    previousUnpaidTotal: 0,
    advanceBalance: 80750,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no_outstanding_dues');
});

test('evaluateCashierDepositEligibility excludes advance-covered remaining dues', () => {
  const covered = evaluateCashierDepositEligibility({
    currentUnpaid: 50000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 50000,
    requiredAmount: 50000,
  });
  assert.equal(covered.eligible, false);
  assert.equal(covered.reason, 'advance_covers_target');
  assert.equal(covered.coverageNeed, 50000);

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
  assert.equal(result.coverageNeed, 50000);
});

test('strict rule hides when advance covers current remaining + prior dues', () => {
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

test('coverage uses remaining dues only, not full configured target', () => {
  // Partial current unpaid 2000; advance 2000 covers remaining — hide even if target is 5000.
  const covered = evaluateCashierDepositEligibility({
    currentUnpaid: 2000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 2000,
    requiredAmount: 5000,
  });
  assert.equal(covered.eligible, false);
  assert.equal(covered.coverageNeed, 2000);

  // Advance below remaining dues — still show.
  const needsPay = evaluateCashierDepositEligibility({
    currentUnpaid: 2000,
    previousUnpaidCount: 0,
    previousUnpaidTotal: 0,
    advanceBalance: 1500,
    requiredAmount: 5000,
  });
  assert.equal(needsPay.eligible, true);
  assert.equal(needsPay.coverageNeed, 2000);
});

test('evaluateCashierDepositEligibility keeps members when advance cannot cover remaining dues', () => {
  const result = evaluateCashierDepositEligibility({
    currentUnpaid: 54000,
    previousUnpaidCount: 2,
    previousUnpaidTotal: 100000,
    advanceBalance: 60000,
    requiredAmount: 54000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'prior_arrears');
  assert.equal(result.totalObligation, 154000);
  assert.equal(result.coverageNeed, 154000);
});

test('dues-only list never falls back to showing all members without a target', () => {
  assert.match(monthlyTargetJs, /async function listCashierDepositEligibleMembers/);
  assert.match(monthlyTargetJs, /function evaluateCashierDepositEligibility/);
  assert.match(monthlyTargetJs, /function remainingMonthlyDueAmount/);
  assert.match(monthlyTargetJs, /await syncMonthDues\(yearMonth/);
  assert.match(monthlyTargetJs, /remainingDues/);
  assert.match(monthlyTargetJs, /no_outstanding_dues/);
  assert.doesNotMatch(
    monthlyTargetJs,
    /showing all active members/i
  );
  assert.match(
    monthlyTargetJs,
    /outstanding monthly dues not already covered by Advance Balance/
  );
  assert.match(monthlyTargetJs, /loadPriorUnpaidByMember/);
  assert.match(adminDepositsJs, /\/eligible-members/);
  assert.match(adminDepositsJs, /listCashierDepositEligibleMembers/);
  assert.match(adminDepositsJs, /requireCashierRole/);
  const eligibleIdx = adminDepositsJs.indexOf("router.get('/eligible-members'");
  const receiptIdx = adminDepositsJs.indexOf("router.get('/:id/receipt'");
  assert.ok(eligibleIdx >= 0 && eligibleIdx < receiptIdx);
  assert.match(staffJs, /function ensureDepositEligibleMemberOptions/);
  assert.match(staffJs, /\/api\/admin\/deposits\/eligible-members/);
  assert.match(staffJs, /ensureDepositEligibleMemberOptions\(\)/);
  assert.match(staffHtml, /outstanding monthly dues/i);
  assert.match(staffHtml, /Advances &amp; Borrow/i);
});
