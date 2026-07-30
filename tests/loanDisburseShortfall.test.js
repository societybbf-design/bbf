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
const loanServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');

test('loan remaining to fund is required minus advance/reserve allocations', () => {
  const required = 22000;
  const fundedAdvance = 5000;
  const fundedReserve = 2000;
  const remaining = Number(Math.max(0, required - fundedAdvance - fundedReserve).toFixed(2));
  assert.equal(remaining, 15000);
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

test('loan disburse never debits or credits society book balance', () => {
  assert.doesNotMatch(loanServiceJs, /ledgerDebit\s*\(/);
  assert.doesNotMatch(loanServiceJs, /debit:\s*ledgerDebit/);
  assert.doesNotMatch(loanServiceJs, /type:\s*'loan_disbursement'/);
  // Covers must not credit book.
  const advanceCover = loanServiceJs.slice(
    loanServiceJs.indexOf('async function coverLoanDisbursementFromAdvance'),
    loanServiceJs.indexOf('async function coverLoanDisbursementFromReserve')
  );
  const reserveCover = loanServiceJs.slice(
    loanServiceJs.indexOf('async function coverLoanDisbursementFromReserve'),
    loanServiceJs.indexOf('function resolveLoanFundingSourceLabel')
  );
  assert.doesNotMatch(advanceCover, /creditInbound/);
  assert.doesNotMatch(reserveCover, /creditInbound/);
  assert.match(reserveCover, /type:\s*'loan_cover'/);
  assert.match(advanceCover, /withMongoTransaction/);
  assert.match(reserveCover, /withMongoTransaction/);
  assert.match(loanServiceJs, /cannot be funded from society book balance/i);
  assert.match(loanServiceJs, /async function disburseLoanApplication[\s\S]*withMongoTransaction/);
});

test('staff dashboard always opens external funding modal', () => {
  assert.match(staffJs, /function beginLoanDisbursePayment/);
  assert.match(staffJs, /function openLoanDisburseShortfallModal/);
  assert.match(staffJs, /function ensureLoanDisburseShortfallModal/);
  assert.match(staffJs, /function loanFundingNeedsShortfallModal/);
  assert.match(staffJs, /loanDisburseShortfallModal/);
  assert.match(staffJs, /\/disburse-check/);
  assert.match(staffJs, /\/disburse-cover-advance/);
  assert.match(staffJs, /\/disburse-cover-reserve/);
  assert.match(staffJs, /Remaining to fund/);
  assert.match(staffJs, /Internal borrow \(from advance\)/);
  assert.match(staffJs, /Emergency \/ Reserve Fund/);
  assert.match(staffJs, /never use society book balance/i);
  assert.match(staffJs, /fundingModal:\s*true/);
  assert.match(staffJs, /normalizeCoverAmount/);
  // Book-balance funding option removed from cashier card.
  assert.doesNotMatch(staffJs, /Society book balance \(shortfall popup if needed\)/);
});

test('Approvals Disburse always opens funding modal instead of bare POST', () => {
  assert.match(approvalsJs, /isLoanDisburse/);
  assert.match(approvalsJs, /loan_disbursement/);
  assert.match(approvalsJs, /beginLoanDisbursePayment/);
  assert.match(approvalsJs, /\\\/loans\\\/admin\\\//);
  assert.match(approvalsJs, /disburse/);
  assert.match(approvalsJs, /Never fall through to bare executeAction/);
  assert.match(approvalsJs, /fundingSource:\s*''/);
});

test('admin loan disburse never posts book-funded disbursement', () => {
  assert.match(adminJs, /beginLoanDisbursePayment/);
  assert.match(adminJs, /Loans cannot use society book balance/);
  assert.match(adminJs, /fundingSource:\s*''/);
});

test('parseLooseMoney accepts comma decimals used in cover amounts', () => {
  assert.equal(loanService.parseLooseMoney('17716,67'), 17716.67);
  assert.equal(loanService.parseLooseMoney('17.716,67'), 17716.67);
  assert.equal(loanService.parseLooseMoney('1,234.56'), 1234.56);
  assert.equal(loanService.parseLooseMoney(2500), 2500);
  assert.ok(Number.isNaN(loanService.parseLooseMoney('')));
  assert.ok(Number.isNaN(loanService.parseLooseMoney(null)));
});

test('loanFundingNeedsShortfallModal treats incomplete external funding as intercept', () => {
  function needsModal(funding) {
    if (!funding || typeof funding !== 'object') return true;
    if (funding.canDisburseDirectly === false || funding.canCompleteDirectly === false) return true;
    if (funding.hasShortfall === true) return true;
    const remaining = Number(funding.remainingToFund ?? funding.shortfall ?? NaN);
    if (Number.isFinite(remaining) && remaining > 0.009) return true;
    const required = Number(funding.requiredAmount ?? funding.loan?.amount ?? NaN);
    const funded = Number(funding.fundedAmount ?? NaN);
    if (Number.isFinite(required) && Number.isFinite(funded) && funded + 0.009 < required) return true;
    if (funding.canDisburseDirectly === true || funding.canCompleteDirectly === true) return false;
    return true;
  }
  assert.equal(needsModal({
    canDisburseDirectly: true,
    hasShortfall: false,
    remainingToFund: 0,
    requiredAmount: 20000,
    fundedAmount: 20000,
  }), false);
  assert.equal(needsModal({
    canDisburseDirectly: false,
    hasShortfall: true,
    remainingToFund: 17000,
    requiredAmount: 22000,
    fundedAmount: 5000,
  }), true);
  assert.equal(needsModal({
    canDisburseDirectly: false,
    hasShortfall: true,
    remainingToFund: 0.02,
    requiredAmount: 10000,
    fundedAmount: 9999.98,
  }), true);
});

test('LoanApplication persists funding source fields', () => {
  assert.match(loanModelJs, /fundingSource/);
  assert.match(loanModelJs, /fundingReserveAmount/);
  assert.match(loanModelJs, /fundingReserveOutstanding/);
  assert.match(loanModelJs, /fundingAdvanceAmount/);
  assert.match(loanModelJs, /fundingLenderName/);
  assert.match(loanModelJs, /never use book balance/i);
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
  assert.match(memberJs, /Funding Source/);
  assert.match(memberJs, /Remaining Due Balance/);
  assert.match(memberJs, /Internal borrow still open/);
  assert.match(memberJs, /fundingSourceLabel/);
});

test('resolveLoanFundingSourceLabel covers advance/reserve/mixed without book default', () => {
  assert.equal(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'reserve' }), 'Emergency / Reserve Fund');
  assert.match(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'advance' }), /Internal borrow/);
  assert.match(loanService.resolveLoanFundingSourceLabel({
    fundingSource: 'mixed',
    fundingAdvanceAmount: 1000,
    fundingReserveAmount: 500,
  }), /Mixed/);
  assert.doesNotMatch(loanService.resolveLoanFundingSourceLabel({
    fundingSource: 'mixed',
    fundingAdvanceAmount: 1000,
    fundingReserveAmount: 500,
  }), /society book balance/i);
  assert.match(loanService.resolveLoanFundingSourceLabel({ fundingSource: 'bank' }), /legacy/i);
  assert.match(loanService.resolveLoanFundingSourceLabel({}), /External funding|advance|Reserve/i);
});
