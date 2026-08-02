'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const financeService = fs.readFileSync(path.join(root, 'services/projectFinanceService.js'), 'utf8');
const opsService = fs.readFileSync(path.join(root, 'services/projectOpsService.js'), 'utf8');
const portalService = fs.readFileSync(path.join(root, 'services/externalInvestorPortalService.js'), 'utf8');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const approvalsInbox = fs.readFileSync(path.join(root, 'services/approvalsInboxService.js'), 'utf8');
const investmentRoutes = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const externalRoutes = fs.readFileSync(path.join(root, 'routes/externalInvestor.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const expenseModel = fs.readFileSync(path.join(root, 'models/ProjectExpense.js'), 'utf8');
const payoutModel = fs.readFileSync(path.join(root, 'models/ExternalPayoutRequest.js'), 'utf8');

test('ProjectExpense supports external approval statuses and per-investor approvals', () => {
  assert.match(expenseModel, /pending_external_approval/);
  assert.match(expenseModel, /external_approved/);
  assert.match(expenseModel, /external_rejected/);
  assert.match(expenseModel, /externalApprovals/);
  assert.match(expenseModel, /shareAmount/);
});

test('ExternalPayoutRequest supports approved→paid CEO execute and expense kind', () => {
  assert.match(payoutModel, /'approved'/);
  assert.match(payoutModel, /'paid'/);
  assert.match(payoutModel, /'expense'/);
  assert.match(payoutModel, /project_expense/);
  assert.match(payoutModel, /executedAt/);
  assert.match(payoutModel, /executedBy/);
});

test('CEO cash deposit service and route are wired', () => {
  assert.match(financeService, /async function recordCeoExternalInvestorDeposit/);
  assert.match(financeService, /creditExternalCapital/);
  assert.match(financeService, /capitalReceived/);
  assert.match(financeService, /remaining committed capital/i);
  assert.match(investmentRoutes, /external-investors\/:investorId\/deposits/);
  assert.match(investmentRoutes, /recordCeoExternalInvestorDeposit/);
  assert.match(investmentRoutes, /requireCeo/);
  assert.match(investmentRoutes, /requirePasswordConfirmation/);
});

test('CEO External Investor profile UI exposes deposit form and payment queue', () => {
  assert.match(adminJs, /Record cash deposit/);
  assert.match(adminJs, /ceoExternalDepositForm/);
  assert.match(adminJs, /external-investors\/\$\{investorId\}\/deposits/);
  assert.match(adminJs, /CEO payment queue/);
  assert.match(adminJs, /data-execute-external-payout/);
  assert.match(adminJs, /data-execute-external-expense/);
  assert.match(adminJs, /Pay from external ledger/);
  assert.match(adminJs, /bindExternalInvestorDetailActions/);
  assert.match(adminJs, /Awaiting CEO action|Awaiting CEO payment/);
});

test('portfolio summarizes capital remaining and CEO payment queue', () => {
  assert.match(investmentService, /capitalRemaining/);
  assert.match(investmentService, /awaitingCeoPayment/);
  assert.match(investmentService, /expenseRequests/);
  assert.match(investmentService, /external_approved/);
});

test('PM expense with external share routes to External Investor then CEO execute', () => {
  assert.match(opsService, /pending_external_approval/);
  assert.match(opsService, /buildExternalApprovals/);
  assert.match(opsService, /decideExternalExpenseApproval/);
  assert.match(opsService, /status = 'external_approved'/);
  assert.match(opsService, /expense\.status === 'external_approved'/);
  assert.match(opsService, /debitExternalExpenseShare/);
  assert.match(opsService, /status = 'executed'/);
  assert.match(externalRoutes, /expenses\/:id\/decide/);
  assert.match(externalRoutes, /decideExternalExpenseApproval/);
});

test('external portal lists expense approvals and notes CEO pays after approve', () => {
  assert.match(portalService, /expenseApprovals/);
  assert.match(portalService, /listExternalInvestorExpenseApprovals/);
  assert.match(staffJs, /expenseApprovals/);
  assert.match(staffJs, /data-external-expense-approve/);
  assert.match(staffJs, /decideExternalExpense/);
  assert.match(staffJs, /After you approve, the CEO executes final payment/);
  assert.match(staffJs, /awaiting CEO disbursement|awaiting CEO payment/);
});

test('payout approval stops at approved; CEO execute pays from ledger', () => {
  assert.match(portalService, /request\.status = 'approved'/);
  assert.match(portalService, /Awaiting CEO final disbursement/);
  assert.match(portalService, /async function ceoExecuteExternalPayout/);
  assert.match(portalService, /request\.status !== 'approved'/);
  assert.match(portalService, /debitExternalCapitalOut/);
  assert.match(portalService, /debitExternalProfitPayout/);
  assert.match(investmentRoutes, /external-payouts\/:requestId\/execute/);
  assert.match(investmentRoutes, /ceoExecuteExternalPayout/);
});

test('approvals inbox surfaces external-approved expenses for CEO payment', () => {
  assert.match(approvalsInbox, /external_approved/);
  assert.match(approvalsInbox, /Pay from external ledger/);
});

test('liquidation and monthly still deduct external-specific expenses before distribute', () => {
  assert.match(financeService, /externalExtraExpenses/);
  assert.match(financeService, /queueExternalSettlementPayouts/);
  assert.match(adminJs, /projectLiquidateExternalExpenses|externalExtraExpenses/);
});

test('decideExternalPayoutRequest sets approved without immediate ledger debit', async () => {
  const ExternalPayoutRequest = require('../models/ExternalPayoutRequest');
  const originalFindById = ExternalPayoutRequest.findById;
  let saved = null;
  const fakeRequest = {
    _id: 'req1',
    investor: 'ext1',
    investorName: 'Ext One',
    investmentCode: 'INV-1',
    amount: 100,
    status: 'pending_external_approval',
    decidedAt: null,
    decidedBy: '',
    decisionNote: '',
    async save() {
      saved = { ...this };
      return this;
    },
  };
  ExternalPayoutRequest.findById = async () => fakeRequest;
  const adminNotify = require('../services/adminNotificationService');
  const originalNotify = adminNotify.createAdminNotification;
  adminNotify.createAdminNotification = async () => ({});
  try {
    const { decideExternalPayoutRequest } = require('../services/externalInvestorPortalService');
    const result = await decideExternalPayoutRequest(
      { id: 'ext1', _id: 'ext1', role: 'external_investor', name: 'Ext One' },
      'req1',
      { approve: true }
    );
    assert.equal(result.request.status, 'approved');
    assert.equal(saved.status, 'approved');
    assert.match(result.message, /CEO|disbursement|ledger/i);
  } finally {
    ExternalPayoutRequest.findById = originalFindById;
    adminNotify.createAdminNotification = originalNotify;
  }
});
