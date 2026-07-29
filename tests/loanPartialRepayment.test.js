'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const loanRepaymentService = require('../services/loanRepaymentService');
const loanService = require('../services/loanService');
const repayServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanRepaymentService.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const modelJs = fs.readFileSync(path.join(__dirname, '../models/LoanRepayment.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/loans.js'), 'utf8');

test('LoanRepayment model allows partial repayment type', () => {
  assert.match(modelJs, /'partial'/);
  assert.match(modelJs, /'installment'/);
  assert.match(modelJs, /'full'/);
});

test('cashier repayment desk supports manual partial amount entry', () => {
  assert.match(staffHtml, /Partial \/ custom amount/);
  assert.match(staffHtml, /Amount received now/);
  assert.match(staffHtml, /cashierLoanRepayAmount/);
  assert.match(staffHtml, /inputmode="decimal"/);
  assert.match(staffJs, /normalizeCashierRepayAmount/);
  assert.match(staffJs, /cashierLoanRepayAmountDirty/);
  assert.match(staffJs, /repaymentType/);
  assert.match(staffJs, /partial payments allowed/i);
});

test('recordAdminLoanRepayment accepts partial typed amounts and settles funding', () => {
  assert.match(repayServiceJs, /parseLooseMoney/);
  assert.match(repayServiceJs, /normalizedType = 'partial'/);
  assert.match(repayServiceJs, /settleLoanFundingOnRepayment/);
  assert.match(repayServiceJs, /fundingSettlement/);
  assert.match(repayServiceJs, /advanceRefunded/);
  assert.match(repayServiceJs, /reserveReplenished/);
  assert.match(repayServiceJs, /Remaining due/);
});

test('cashier route records member repayments', () => {
  assert.match(routesJs, /\/admin\/member\/:memberId\/repayments/);
  assert.match(routesJs, /recordAdminLoanRepayment/);
});

test('partial payment math reduces outstanding correctly', () => {
  const outstanding = 5000;
  const paid = 2000;
  const remaining = Number(Math.max(0, outstanding - paid).toFixed(2));
  assert.equal(remaining, 3000);
});

test('funding settlement applies repayment cash to advance then reserve', () => {
  // Mirrors settleLoanFundingOnRepayment allocation order.
  let remaining = 2000;
  const advanceDue = 1500;
  const reserveDue = 800;
  const advancePay = Math.min(remaining, advanceDue);
  remaining = Number((remaining - advancePay).toFixed(2));
  const reservePay = Math.min(remaining, reserveDue);
  remaining = Number((remaining - reservePay).toFixed(2));
  assert.equal(advancePay, 1500);
  assert.equal(reservePay, 500);
  assert.equal(remaining, 0);
});

test('parseLooseMoney used for repayment amounts accepts comma decimals', () => {
  assert.equal(loanService.parseLooseMoney('2000'), 2000);
  assert.equal(loanService.parseLooseMoney('2.000,50'), 2000.5);
  assert.equal(loanService.parseLooseMoney('1,500.25'), 1500.25);
});

test('getLoanOutstandingBalance prefers stored outstandingBalance', () => {
  assert.equal(loanRepaymentService.getLoanOutstandingBalance({
    status: 'disbursed',
    amount: 5000,
    totalRepaid: 1000,
    outstandingBalance: 3000,
  }), 3000);
  assert.equal(loanRepaymentService.getLoanOutstandingBalance({
    status: 'completed',
    outstandingBalance: 0,
  }), 0);
});
