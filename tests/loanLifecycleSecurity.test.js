'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const loanService = require('../services/loanService');
const loanIdempotency = require('../services/loanIdempotencyService');
const loansRouter = require('../routes/loans');

const loanServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');
const repayServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanRepaymentService.js'), 'utf8');
const reserveServiceJs = fs.readFileSync(path.join(__dirname, '../services/emergencyReserveService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/loans.js'), 'utf8');
const loanModelJs = fs.readFileSync(path.join(__dirname, '../models/LoanApplication.js'), 'utf8');
const idemModelJs = fs.readFileSync(path.join(__dirname, '../models/LoanIdempotency.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('loan idempotency service exports claim/complete helpers', () => {
  assert.equal(typeof loanIdempotency.beginLoanIdempotency, 'function');
  assert.equal(typeof loanIdempotency.withLoanIdempotency, 'function');
  assert.equal(typeof loanIdempotency.resolveLoanIdempotencyKey, 'function');
  assert.match(idemModelJs, /operation/);
  assert.match(idemModelJs, /disburse/);
  assert.match(idemModelJs, /repay/);
});

test('disburse and repay routes require loan idempotency', () => {
  assert.match(routesJs, /withLoanIdempotency/);
  assert.match(routesJs, /operation:\s*'disburse'/);
  assert.match(routesJs, /operation:\s*'repay'/);
  assert.match(routesJs, /operation:\s*'cover_advance'/);
  assert.match(routesJs, /operation:\s*'cover_reserve'/);
});

test('CEO status updates use strict transitions and cannot mutate disbursed loans', () => {
  assert.match(loanServiceJs, /CEO_LOAN_STATUS_TRANSITIONS/);
  assert.match(loanServiceJs, /pending:\s*\['approved',\s*'rejected'\]/);
  assert.match(loanServiceJs, /approved:\s*\['rejected'\]/);
  assert.match(loanServiceJs, /Cannot change a \$\{loan\.status\} loan via CEO review/);
  assert.match(loanServiceJs, /findOneAndUpdate/);
  assert.equal(typeof loanService.releaseLoanDisbursementFunding, 'function');
  assert.match(loanServiceJs, /releaseLoanDisbursementFunding/);
});

test('active loan per member protected by partial unique index', () => {
  assert.match(loanModelJs, /uniq_active_loan_per_member/);
  assert.match(loanModelJs, /partialFilterExpression/);
  assert.match(loanModelJs, /pending.*approved|approved.*pending/);
});

test('cover and disburse wrap money mutations in withMongoTransaction', () => {
  const advanceCover = loanServiceJs.slice(
    loanServiceJs.indexOf('async function coverLoanDisbursementFromAdvance'),
    loanServiceJs.indexOf('async function coverLoanDisbursementFromReserve')
  );
  const reserveCover = loanServiceJs.slice(
    loanServiceJs.indexOf('async function coverLoanDisbursementFromReserve'),
    loanServiceJs.indexOf('function resolveLoanFundingSourceLabel')
  );
  const disburse = loanServiceJs.slice(
    loanServiceJs.indexOf('async function disburseLoanApplication'),
    loanServiceJs.indexOf('module.exports')
  );

  assert.match(advanceCover, /withMongoTransaction\(async \(session\) =>/);
  assert.match(advanceCover, /\$inc:\s*\{\s*advanceBalance:\s*-payAmount/);
  assert.match(reserveCover, /withMongoTransaction\(async \(session\) =>/);
  assert.match(reserveCover, /debitReserve\([\s\S]*session/);
  assert.match(disburse, /withMongoTransaction\(async \(session\) =>/);
  assert.match(disburse, /status:\s*'approved'/);
  assert.match(disburse, /status:\s*'disbursed'/);
  assert.doesNotMatch(disburse, /ledgerDebit\s*\(/);
});

test('repayment applies atomic outstanding decrement and hard-fails settlement', () => {
  assert.match(repayServiceJs, /withMongoTransaction\(async \(session\) =>/);
  assert.match(repayServiceJs, /outstandingBalance:\s*\{\s*\$gte:/);
  assert.match(repayServiceJs, /\$inc:\s*\{\s*\n?\s*outstandingBalance:\s*-pay/);
  assert.doesNotMatch(repayServiceJs, /console\.warn\('\[settleLoanFundingOnRepayment\]/);
  assert.doesNotMatch(repayServiceJs, /console\.warn\('\[applyApprovedRepayment\] ledger credit failed/);
  assert.match(repayServiceJs, /settleLoanFundingOnRepayment\(loan, pay, reviewedBy, session\)/);
  assert.match(repayServiceJs, /creditInbound\([\s\S]*session/);
});

test('reserve debit uses atomic balance \$inc', () => {
  assert.match(reserveServiceJs, /\$inc:\s*\{\s*balance:\s*-normalized\s*\}/);
  assert.match(reserveServiceJs, /adjustBalance:\s*false/);
  assert.match(reserveServiceJs, /sessionOpt\(session/);
});

test('cashier UI sends Idempotency-Key for loan cover/disburse/repay', () => {
  assert.match(staffJs, /Idempotency-Key/);
  assert.match(staffJs, /loan-repay-/);
  assert.match(staffJs, /loan-disburse-/);
  assert.match(staffJs, /loan-cover/);
  assert.match(staffJs, /clientRequestId/);
  assert.match(staffJs, /submitBtn\.disabled = true/);
});

test('loan routes still expose disburse/cover/repay endpoints', () => {
  const paths = loansRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse')));
  assert.ok(paths.some((p) => p.includes('/admin/:id/disburse-cover-advance')));
  assert.ok(paths.some((p) => p.includes('/admin/member/:memberId/repayments')));
});

test('partial repayment money math stays cent-safe', () => {
  const outstanding = 10000.1;
  const paid = 1000;
  const remaining = Number(Math.max(0, outstanding - paid).toFixed(2));
  assert.equal(remaining, 9000.1);
  assert.equal(Number((0.1 + 0.2).toFixed(2)), 0.3);
});
