'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const serviceJs = fs.readFileSync(path.join(__dirname, '../services/smartRepaymentService.js'), 'utf8');
const { buildSmartPaymentPlan } = require('../services/smartRepaymentService');

test('smart repayment service no longer loads or applies formal loan repayments', () => {
  assert.doesNotMatch(serviceJs, /getMemberOutstandingSummary/);
  assert.doesNotMatch(serviceJs, /recordAdminLoanRepayment/);
  assert.doesNotMatch(serviceJs, /loan_repayment/);
  assert.doesNotMatch(serviceJs, /toLoan/);
  assert.match(serviceJs, /loan: null/);
  assert.match(serviceJs, /Formal member loans are excluded/);
});

test('surplus that previously went to loan now stays available for monthly then advance', () => {
  const plan = buildSmartPaymentPlan({
    yearMonth: '2026-07',
    legs: {
      internalBorrowings: [],
      unpaidContributions: [],
      loan: { loanId: 'ignored', outstanding: 9999 },
      monthlyDeposit: { outstanding: 1000, targetAmount: 1000 },
    },
  }, 1000);
  assert.equal(plan.summary.toMonthly, 1000);
  assert.equal(plan.summary.toAdvance, 0);
  assert.deepEqual(plan.allocations.map((a) => a.kind), ['monthly_deposit']);
});
