'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isWithinAutoDeductionWindow,
  DEDUCTION_WINDOW_END_DAY,
} = require('../services/monthlyAutoDeductionService');
const { buildSmartPaymentPlan } = require('../services/smartRepaymentService');
const monthlyTargetJs = fs.readFileSync(path.join(__dirname, '../services/monthlyTargetService.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('auto deduction window is 1st through 15th', () => {
  assert.equal(DEDUCTION_WINDOW_END_DAY, 15);
  assert.equal(isWithinAutoDeductionWindow(new Date('2026-07-01')), true);
  assert.equal(isWithinAutoDeductionWindow(new Date('2026-07-15')), true);
  assert.equal(isWithinAutoDeductionWindow(new Date('2026-07-16')), false);
});

test('smart payment plan allocates across liabilities then advance surplus', () => {
  const liabilities = {
    yearMonth: '2026-07',
    legs: {
      internalBorrowings: [{
        borrowingId: 'b1',
        label: 'Borrow A',
        lenderName: 'Lender',
        outstanding: 500,
      }],
      unpaidContributions: [{
        contributionId: 'c1',
        label: 'Project share',
        outstanding: 300,
      }],
      loan: { loanId: 'l1', outstanding: 1000 },
      monthlyDeposit: { outstanding: 2000, targetAmount: 2000 },
    },
  };

  const plan = buildSmartPaymentPlan(liabilities, 5000);
  assert.equal(plan.summary.toLenders, 500);
  assert.equal(plan.summary.toProjectDues, 300);
  assert.equal(plan.summary.toLoan, 1000);
  assert.equal(plan.summary.toMonthly, 2000);
  assert.equal(plan.summary.toAdvance, 1200);
  assert.equal(plan.allocations.reduce((s, a) => s + a.amount, 0), 5000);
});

test('smart payment with no liabilities routes all to advance', () => {
  const plan = buildSmartPaymentPlan({
    yearMonth: '2026-07',
    legs: {
      internalBorrowings: [],
      unpaidContributions: [],
      loan: null,
      monthlyDeposit: null,
    },
  }, 1500);
  assert.equal(plan.allocations.length, 1);
  assert.equal(plan.allocations[0].kind, 'advance_surplus');
  assert.equal(plan.allocations[0].amount, 1500);
});

test('monthly target service exposes year plan bulk helpers', () => {
  assert.match(monthlyTargetJs, /async function listTargetsForYear/);
  assert.match(monthlyTargetJs, /async function bulkUpsertTargets/);
  assert.match(monthlyTargetJs, /for \(let m = 1; m <= 12; m \+= 1\)/);
});

test('scheduled jobs start after server bootstrap', () => {
  assert.match(serverJs, /startScheduledJobs/);
  assert.match(serverJs, /scheduledJobsService/);
});
