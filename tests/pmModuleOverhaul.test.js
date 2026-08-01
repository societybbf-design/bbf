'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const investmentModel = fs.readFileSync(path.join(__dirname, '../models/Investment.js'), 'utf8');
const expenseModel = fs.readFileSync(path.join(__dirname, '../models/ProjectExpense.js'), 'utf8');
const reportModel = fs.readFileSync(path.join(__dirname, '../models/ProjectMonthlyReport.js'), 'utf8');
const extLedgerModel = fs.readFileSync(path.join(__dirname, '../models/ExternalInvestorLedger.js'), 'utf8');
const extEntryModel = fs.readFileSync(path.join(__dirname, '../models/ExternalInvestorLedgerEntry.js'), 'utf8');
const investmentJs = fs.readFileSync(path.join(__dirname, '../services/investmentService.js'), 'utf8');
const financeJs = fs.readFileSync(path.join(__dirname, '../services/projectFinanceService.js'), 'utf8');
const opsJs = fs.readFileSync(path.join(__dirname, '../services/projectOpsService.js'), 'utf8');
const extLedgerJs = fs.readFileSync(path.join(__dirname, '../services/externalInvestorLedgerService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/investments.js'), 'utf8');
const inboxJs = fs.readFileSync(path.join(__dirname, '../services/approvalsInboxService.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const {
  normalizeOwnership,
} = require('../services/projectFinanceService');

test('Investment status includes pending_ceo_authorization for maker-checker', () => {
  assert.match(investmentModel, /pending_ceo_authorization/);
  assert.match(investmentModel, /ceoAuthorizedAt/);
  assert.match(investmentJs, /async function authorizeInvestmentByCeo/);
  assert.match(investmentJs, /investment\.status = 'pending_ceo_authorization'/);
  assert.match(investmentJs, /investment\.status = 'pending_cashier_payment'/);
});

test('society ownership defaults to 100% with exact total validation', () => {
  const defaults = normalizeOwnership({ amount: 1000 });
  assert.equal(defaults.societyOwnershipPct, 100);
  assert.equal(defaults.investorOwnershipPct, 0);
  assert.throws(
    () => normalizeOwnership({
      amount: 1000,
      societyOwnershipPct: 70,
      investorOwnershipPct: 20,
    }),
    /100/
  );
  const multi = normalizeOwnership({
    amount: 1000,
    societyOwnershipPct: 60,
    externalInvestors: [
      { ownershipPct: 25, investorName: 'A' },
      { ownershipPct: 15, investorName: 'B' },
    ],
  });
  assert.equal(multi.societyOwnershipPct + multi.investorOwnershipPct, 100);
});

test('project expense and monthly P/L models support maker-checker statuses', () => {
  assert.match(expenseModel, /submitted/);
  assert.match(expenseModel, /ceo_approved/);
  assert.match(reportModel, /pending_ceo/);
  assert.match(reportModel, /external_payout_queued/);
  assert.match(opsJs, /async function createProjectExpense/);
  assert.match(opsJs, /async function createOrSubmitMonthlyReport/);
  assert.match(opsJs, /async function ceoReviewMonthlyReport/);
  assert.match(opsJs, /Net Profit|netProfit/);
});

test('external investor ledger is isolated from society bank ledger', () => {
  assert.match(extLedgerModel, /ExternalInvestorLedger/);
  assert.match(extEntryModel, /external_capital_in/);
  assert.match(extLedgerJs, /Never touches Society BankLedger|never touches Society/i);
  assert.match(financeJs, /creditExternalCapital/);
  assert.match(financeJs, /society bank ledger was not affected|society bank unchanged/i);
  // recordExternalInvestment must not credit society bank anymore.
  const recordFn = financeJs.match(
    /async function recordExternalInvestment[\s\S]*?^async function /m
  )?.[0] || financeJs;
  assert.match(recordFn, /creditExternalCapital/);
  assert.doesNotMatch(recordFn, /creditInbound\(\{\s*type:\s*'external_investment'/);
});

test('monthly return credits society share only to society bank', () => {
  assert.match(financeJs, /amount:\s*split\.societyShare/);
  assert.match(financeJs, /creditExternalProfitAccrual/);
});

test('PM workspace routes and CEO ops endpoints exist', () => {
  assert.match(routesJs, /\/pm\/workspace/);
  assert.match(routesJs, /scopedToProjectManager/);
  assert.match(routesJs, /\/:id\/expenses/);
  assert.match(routesJs, /\/:id\/monthly-report/);
  assert.match(routesJs, /\/:id\/ceo-authorize/);
  assert.match(routesJs, /\/:id\/external-ledger/);
  assert.match(routesJs, /requireCeo/);
});

test('approvals inbox surfaces CEO authorization and P/L expense reviews', () => {
  assert.match(inboxJs, /investment_ceo_authorization/);
  assert.match(inboxJs, /ceo-authorize/);
  assert.match(inboxJs, /project_expense_review/);
  assert.match(inboxJs, /project_monthly_report/);
  assert.match(inboxJs, /external_payout_queued|external payout channel/);
});

test('PM staff dashboard exposes maker workspace UI', () => {
  assert.match(staffHtml, /data-pm-only/);
  assert.match(staffHtml, /pmExpenseForm/);
  assert.match(staffHtml, /pmMonthlyReportForm/);
  assert.match(staffHtml, /pmCapitalExpandForm|pmExpandCapitalForm|Capital expansion/i);
  assert.match(staffHtml, /pmActivityList|data-pm-investments-panel="activity"/);
  assert.match(staffJs, /function bindPmProjectOpsForms/);
  assert.match(staffJs, /function renderPmProjectsList/);
  assert.match(staffJs, /function renderPmStakeholders/);
  assert.match(staffJs, /project_manager[\s\S]*loadInvestmentsModule|loadInvestmentsModule[\s\S]*project_manager/);
});
