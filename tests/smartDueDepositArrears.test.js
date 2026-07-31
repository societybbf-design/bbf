'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listYearMonthsInclusive,
} = require('../services/monthlyTargetService');
const { buildSmartPaymentPlan } = require('../services/smartRepaymentService');

const monthlyTargetJs = fs.readFileSync(path.join(__dirname, '../services/monthlyTargetService.js'), 'utf8');
const smartJs = fs.readFileSync(path.join(__dirname, '../services/smartRepaymentService.js'), 'utf8');
const memberServiceJs = fs.readFileSync(path.join(__dirname, '../services/memberService.js'), 'utf8');
const adminDepositsJs = fs.readFileSync(path.join(__dirname, '../routes/adminDeposits.js'), 'utf8');
const memberRoutesJs = fs.readFileSync(path.join(__dirname, '../routes/member.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');

test('listYearMonthsInclusive returns chronological inclusive range', () => {
  assert.deepEqual(listYearMonthsInclusive('2026-05', '2026-07'), [
    '2026-05',
    '2026-06',
    '2026-07',
  ]);
  assert.deepEqual(listYearMonthsInclusive('2025-11', '2026-02'), [
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
  ]);
  assert.deepEqual(listYearMonthsInclusive('2026-07', '2026-07'), ['2026-07']);
  assert.deepEqual(listYearMonthsInclusive('2026-08', '2026-07'), []);
});

test('getMemberArrearsSummary computes previous + current and message copy', () => {
  assert.match(monthlyTargetJs, /async function getMemberArrearsSummary/);
  assert.match(monthlyTargetJs, /listYearMonthsInclusive\(startYearMonth, currentYearMonth\)/);
  assert.match(monthlyTargetJs, /This member has unpaid dues for \$\{previousMonthsCount\} previous month\(s\)/);
  assert.match(monthlyTargetJs, /Total required deposit including current month/);
  assert.match(monthlyTargetJs, /You missed \$\{previousMonthsCount\} previous month\(s\)/);
  assert.match(monthlyTargetJs, /Total due:/);
  assert.match(monthlyTargetJs, /previousUnpaidCount: previousMonthsCount/);
  assert.match(monthlyTargetJs, /memberDashboard:/);
  assert.match(
    monthlyTargetJs,
    /const currentUnpaid = currentMonth \? money\(currentMonth\.unpaidAmount\) : 0/
  );
});

test('smart payment allocates monthly dues oldest-first across multiple months', () => {
  const liabilities = {
    yearMonth: '2026-07',
    legs: {
      internalBorrowings: [],
      unpaidContributions: [],
      monthlyDepositMonths: [
        {
          yearMonth: '2026-05',
          outstanding: 1000,
          label: 'Monthly arrears 2026-05',
          isCurrent: false,
        },
        {
          yearMonth: '2026-06',
          outstanding: 1000,
          label: 'Monthly arrears 2026-06',
          isCurrent: false,
        },
        {
          yearMonth: '2026-07',
          outstanding: 1000,
          label: 'Monthly deposit 2026-07 (current)',
          isCurrent: true,
        },
      ],
      monthlyDeposit: { outstanding: 3000, targetAmount: 1000, previousMonthsCount: 2 },
    },
  };

  const full = buildSmartPaymentPlan(liabilities, 3000);
  assert.equal(full.summary.toMonthly, 3000);
  assert.equal(full.summary.toAdvance, 0);
  assert.deepEqual(full.summary.monthlyMonthsCleared, ['2026-05', '2026-06', '2026-07']);
  assert.equal(full.allocations.filter((a) => a.kind === 'monthly_deposit').length, 3);
  assert.equal(full.allocations[0].yearMonth, '2026-05');
  assert.equal(full.allocations[1].yearMonth, '2026-06');
  assert.equal(full.allocations[2].yearMonth, '2026-07');

  const partial = buildSmartPaymentPlan(liabilities, 1500);
  assert.deepEqual(partial.summary.monthlyMonthsCleared, ['2026-05', '2026-06']);
  assert.equal(partial.allocations[0].amount, 1000);
  assert.equal(partial.allocations[1].amount, 500);
  assert.equal(partial.summary.toAdvance, 0);

  const surplus = buildSmartPaymentPlan(liabilities, 3500);
  assert.equal(surplus.summary.toMonthly, 3000);
  assert.equal(surplus.summary.toAdvance, 500);
});

test('getMemberPaymentLiabilities uses arrears months and apply uses withMongoTransaction', () => {
  assert.match(smartJs, /getMemberArrearsSummary\(memberId/);
  assert.match(smartJs, /monthlyDepositMonths/);
  assert.match(smartJs, /Oldest unpaid month first/);
  assert.match(smartJs, /monthlyMonthsCleared/);
  assert.match(smartJs, /withMongoTransaction\(async \(session\) =>/);
  assert.match(smartJs, /yearMonth: leg\.yearMonth \|\| yearMonth/);
});

test('cashier arrears API and member financial expose arrears', () => {
  assert.match(adminDepositsJs, /\/member-arrears\/:memberId/);
  assert.match(adminDepositsJs, /getMemberArrearsSummary/);
  assert.match(adminDepositsJs, /requireCashierRole/);
  assert.match(memberRoutesJs, /arrears/);
  assert.match(memberServiceJs, /getMemberArrearsSummary/);
  assert.match(memberServiceJs, /hasArrears/);
});

test('cashier deposit UI shows arrears banner and defaults amount to totalDue', () => {
  assert.match(staffHtml, /id="cashierDepositArrearsBanner"/);
  assert.match(staffHtml, /oldest unpaid monthly dues/);
  assert.match(staffHtml, /Total monthly dues \(incl\. arrears\)/);
  assert.match(staffJs, /function loadMemberDepositArrears/);
  assert.match(staffJs, /function renderDepositArrearsBanner/);
  assert.match(staffJs, /member-arrears\/\$\{encodeURIComponent\(memberId\)\}/);
  assert.match(staffJs, /amountInput\.value = Number\(remaining\)\.toFixed\(2\)/);
  assert.match(staffJs, /arrears\?\.totalDue/);
});

test('member dashboard shows structured dues breakdown from arrears', () => {
  assert.match(memberHtml, /id="duesAlert"/);
  assert.match(memberHtml, /member-dues-dashboard/);
  assert.match(memberJs, /function renderMemberDuesDashboard/);
  assert.match(memberJs, /Current month required/);
  assert.match(memberJs, /Missed previous months/);
  assert.match(memberJs, /Total due amount/);
  assert.match(memberJs, /startMemberDuesLiveSync/);
});
