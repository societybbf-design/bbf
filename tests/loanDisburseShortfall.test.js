'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const loanService = require('../services/loanService');
const loansRouter = require('../routes/loans');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const approvalsJs = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
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
  assert.equal(typeof loanService.parseLooseMoney, 'function');
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
  assert.match(staffJs, /function loanFundingNeedsShortfallModal/);
  assert.match(staffJs, /loanDisburseShortfallModal/);
  assert.match(staffJs, /\/disburse-check/);
  assert.match(staffJs, /\/disburse-cover-advance/);
  assert.match(staffJs, /\/disburse-cover-reserve/);
  assert.match(staffJs, /Exact shortfall/);
  assert.match(staffJs, /Internal borrow \(from advance\)/);
  assert.match(staffJs, /Emergency \/ Reserve Fund/);
  // Disburse must check balance before POST and re-check before final modal submit.
  assert.match(staffJs, /loanFundingNeedsShortfallModal\(check\)/);
  assert.match(staffJs, /Re-checking book balance/);
  assert.match(staffJs, /normalizeCoverAmount/);
});

test('Approvals Disburse intercepts loan shortfall modal instead of silent error', () => {
  assert.match(approvalsJs, /isLoanDisburse/);
  assert.match(approvalsJs, /loan_disbursement/);
  assert.match(approvalsJs, /beginLoanDisbursePayment/);
  assert.match(approvalsJs, /\\\/loans\\\/admin\\\//);
  assert.match(approvalsJs, /disburse/);
  assert.match(approvalsJs, /Never fall through to bare executeAction/);
});

test('admin loan disburse form checks book balance before POST', () => {
  assert.match(adminJs, /disburse-check/);
  assert.match(adminJs, /beginLoanDisbursePayment/);
  assert.match(adminJs, /Insufficient book balance|Book balance is short/);
});

test('parseLooseMoney accepts comma decimals used in cover amounts', () => {
  assert.equal(loanService.parseLooseMoney('17716,67'), 17716.67);
  assert.equal(loanService.parseLooseMoney('17.716,67'), 17716.67);
  assert.equal(loanService.parseLooseMoney('1,234.56'), 1234.56);
  assert.equal(loanService.parseLooseMoney(2500), 2500);
  assert.ok(Number.isNaN(loanService.parseLooseMoney('')));
  assert.ok(Number.isNaN(loanService.parseLooseMoney(null)));
});

test('loanFundingNeedsShortfallModal logic treats book short of loan as intercept', () => {
  // Mirror the client helper for regression coverage of the bookBalance >= loanAmount rule.
  function needsModal(funding) {
    if (!funding || typeof funding !== 'object') return true;
    if (funding.openingSet === false) return true;
    if (funding.canDisburseDirectly === false || funding.canCompleteDirectly === false) return true;
    if (funding.hasShortfall === true || funding.needsPopup === true) return true;
    const shortfall = Number(funding.shortfall || 0);
    if (Number.isFinite(shortfall) && shortfall > 0.009) return true;
    const required = Number(funding.requiredAmount ?? funding.loan?.amount ?? NaN);
    const book = Number(funding.bookBalance);
    if (Number.isFinite(required) && Number.isFinite(book) && book + 0.009 < required) return true;
    return false;
  }
  assert.equal(needsModal({
    openingSet: true,
    canDisburseDirectly: true,
    hasShortfall: false,
    shortfall: 0,
    requiredAmount: 20000,
    bookBalance: 20000,
  }), false);
  assert.equal(needsModal({
    openingSet: true,
    canDisburseDirectly: false,
    hasShortfall: true,
    shortfall: 17000,
    requiredAmount: 22000,
    bookBalance: 5000,
  }), true);
  assert.equal(needsModal({
    openingSet: false,
    canDisburseDirectly: false,
    hasShortfall: false,
    shortfall: 0,
    requiredAmount: 1000,
    bookBalance: 5000,
  }), true);
  assert.equal(needsModal({
    openingSet: true,
    requiredAmount: 10000,
    bookBalance: 9999.98,
    shortfall: 0.02,
    hasShortfall: true,
    canDisburseDirectly: false,
  }), true);
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
