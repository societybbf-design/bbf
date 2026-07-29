'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const loanService = require('../services/loanService');
const loansRouter = require('../routes/loans');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const approvalsJs = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const loanModelJs = fs.readFileSync(path.join(__dirname, '../models/LoanApplication.js'), 'utf8');
const borrowingModelJs = fs.readFileSync(path.join(__dirname, '../models/InternalBorrowing.js'), 'utf8');
const repayServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanRepaymentService.js'), 'utf8');

test('loan shortfall is required minus book balance floored at zero', () => {
  const required = 22000;
  const book = 5000;
  const shortfall = Number(Math.max(0, required - book).toFixed(2));
  assert.equal(shortfall, 17000);
});

test('loanService exports disbursement funding helpers', () => {
  assert.equal(typeof loanService.previewLoanDisbursement, 'function');
  assert.equal(typeof loanService.coverLoanDisbursementFromAdvance, 'function');
  assert.equal(typeof loanService.coverLoanDisbursementFromReserve, 'function');
  assert.equal(typeof loanService.getLoanDisbursementFundingSnapshot, 'function');
  assert.equal(typeof loanService.resolveLoanFundingSourceLabel, 'function');
});

test('loan routes expose disburse check and cover endpoints', () => {
  const paths = loansRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse-check')));
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse-cover-advance')));
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse-cover-reserve')));
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse')));
});

test('staff dashboard has loan disburse shortfall modal workflow', () => {
  assert.match(staffJs, /function beginLoanDisbursePayment/);
  assert.match(staffJs, /function openLoanDisburseShortfallModal/);
  assert.match(staffJs, /function ensureLoanDisburseShortfallModal/);
  assert.match(staffJs, /loanDisburseShortfallModal/);
  assert.match(staffJs, /\/disburse-check/);
  assert.match(staffJs, /\/disburse-cover-advance/);
  assert.match(staffJs, /\/disburse-cover-reserve/);
  assert.match(staffJs, /Exact shortfall/);
  assert.match(staffJs, /Internal borrow \(from advance\)/);
  assert.match(staffJs, /Emergency \/ Reserve Fund/);
});

test('Approvals Disburse intercepts loan shortfall modal instead of silent error', () => {
  assert.match(approvalsJs, /isLoanDisburse/);
  assert.match(approvalsJs, /beginLoanDisbursePayment/);
  assert.match(approvalsJs, /\\\/loans\\\/admin\\\//);
  assert.match(approvalsJs, /disburse/);
});

test('LoanApplication persists funding source fields', () => {
  assert.match(loanModelJs, /fundingSource/);
  assert.match(loanModelJs, /fundingReserveAmount/);
  assert.match(loanModelJs, /fundingReserveOutstanding/);
  assert.match(loanModelJs, /fundingAdvanceAmount/);
  assert.match(loanModelJs, /fundingLenderName/);
});

test('InternalBorrowing can link to a loan', () => {
  assert.match(borrowingModelJs, /ref: 'LoanApplication'/);
  assert.match(borrowingModelJs, /loan:/);
});

test('loan repayment settles advance lenders and replenishes reserve', () => {
  assert.match(repayServiceJs, /settleLoanFundingOnRepayment/);
  assert.match(repayServiceJs, /settleInternalBorrowing/);
  assert.match(repayServiceJs, /cashReceived: true/);
  assert.match(repayServiceJs, /skipBankCredit: true/);
  assert.match(repayServiceJs, /allocateFromBookBalance/);
  assert.match(repayServiceJs, /fundingReserveOutstanding/);
  assert.match(repayServiceJs, /openBorrowings/);
  assert.match(repayServiceJs, /fundingSourceLabel/);
});

test('member dashboard shows funding source and repayment obligation', () => {
  assert.match(memberJs, /Funded from/);
  assert.match(memberJs, /repayment obligation/);
  assert.match(memberJs, /Internal borrow still open/);
  assert.match(memberJs, /fundingSourceLabel/);
});

test('resolveLoanFundingSourceLabel covers bank/reserve/advance/mixed', () => {
  assert.equal(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'bank' }), 'Society book balance');
  assert.equal(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'reserve' }), 'Emergency / Reserve Fund');
  assert.match(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'advance' }), /Internal borrow/);
  assert.match(loanService.resolveLoanFundingSourceLabel({
    fundingSource: 'mixed',
    fundingAdvanceAmount: 1000,
    fundingReserveAmount: 500,
  }), /Mixed/);
});
