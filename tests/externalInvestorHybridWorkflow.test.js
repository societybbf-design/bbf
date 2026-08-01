'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const financeService = fs.readFileSync(path.join(root, 'services/projectFinanceService.js'), 'utf8');
const portalService = fs.readFileSync(path.join(root, 'services/externalInvestorPortalService.js'), 'utf8');
const chatService = fs.readFileSync(path.join(root, 'services/chatService.js'), 'utf8');
const externalRoutes = fs.readFileSync(path.join(root, 'routes/externalInvestor.js'), 'utf8');
const investmentRoutes = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const rbacJs = fs.readFileSync(path.join(root, 'services/rbac.js'), 'utf8');
const payoutModel = fs.readFileSync(path.join(root, 'models/ExternalPayoutRequest.js'), 'utf8');
const reviewModel = fs.readFileSync(path.join(root, 'models/ProjectManagerReview.js'), 'utf8');

const {
  queueExternalSettlementPayouts,
  money,
} = require('../services/externalInvestorPortalService');

test('ExternalPayoutRequest and ProjectManagerReview models exist with required fields', () => {
  assert.match(payoutModel, /pending_external_approval/);
  assert.match(payoutModel, /externalExtraExpenses/);
  assert.match(reviewModel, /projectManager/);
  assert.match(reviewModel, /rating/);
});

test('monthly return and liquidation accept externalExtraExpenses and queue external approval', () => {
  assert.match(financeService, /externalExtraExpenses\s*=\s*0/);
  assert.match(financeService, /queueExternalSettlementPayouts/);
  assert.match(financeService, /debitExternalExpenseShare/);
  assert.match(financeService, /pending_external_approval/);
  assert.match(investmentRoutes, /externalExtraExpenses:\s*req\.body\?\.externalExtraExpenses/);
});

test('queueExternalSettlementPayouts deducts external expense from profit before capital+net queue', async () => {
  const created = [];
  const ExternalPayoutRequest = require('../models/ExternalPayoutRequest');
  const originalCreate = ExternalPayoutRequest.create;
  ExternalPayoutRequest.create = async (payload) => {
    const doc = { ...payload, _id: `req-${created.length + 1}` };
    created.push(doc);
    return doc;
  };
  try {
    const result = await queueExternalSettlementPayouts({
      investment: { _id: 'inv1', investmentCode: 'INV-TEST-1' },
      investorPayouts: [{
        investor: 'ext1',
        investorName: 'External One',
        capitalShare: 400,
        profitShare: 100,
        lossShare: 0,
        accruedProfit: 0,
        payout: 500,
      }],
      externalExtraExpenses: 30,
      source: 'liquidation',
      createdBy: 'CEO',
    });
    assert.equal(result.externalExtraExpensesApplied, 30);
    assert.equal(created.length, 1);
    assert.equal(money(created[0].capitalAmount), 400);
    assert.equal(money(created[0].profitAmount), 70);
    assert.equal(money(created[0].amount), 470);
    assert.equal(created[0].status, 'pending_external_approval');
  } finally {
    ExternalPayoutRequest.create = originalCreate;
  }
});

test('external investor portal API is mounted and role-gated', () => {
  assert.match(serverJs, /\/api\/external-investor/);
  assert.match(externalRoutes, /requireExternalInvestor/);
  assert.match(externalRoutes, /getExternalInvestorDashboard/);
  assert.match(externalRoutes, /decideExternalPayoutRequest/);
  assert.match(externalRoutes, /submitProjectManagerReview/);
  assert.match(portalService, /Strictly|Isolated portfolio|society pool/i);
});

test('staff chat allows external investor messaging with CEO/PM only', () => {
  assert.match(chatService, /external_investor/);
  assert.match(chatService, /External Investors can only message the CEO/);
  assert.match(externalRoutes, /getStaffMessages/);
  assert.match(externalRoutes, /sendStaffMessage/);
});

test('CEO UI exposes external-specific expense fields on liquidate and monthly return', () => {
  assert.match(adminHtml, /projectLiquidateExternalExpenses/);
  assert.match(adminHtml, /projectMonthlyExternalExpenses/);
  assert.match(adminJs, /externalExtraExpenses/);
  assert.match(adminJs, /projectLiquidateExternalExpenses/);
});

test('external investor dashboard UI is isolated to portal panels', () => {
  assert.match(staffHtml, /data-staff-view="external-portal"/);
  assert.match(staffHtml, /data-staff-view="external-chat"/);
  assert.match(staffJs, /external_investor/);
  assert.match(staffJs, /\/api\/external-investor\/dashboard/);
  assert.match(staffJs, /allowed = new Set\(\['home', 'external-portal', 'external-chat'\]\)/);
  assert.match(rbacJs, /external_investor:\s*\[[\s\S]*can_manage_chat/);
});
