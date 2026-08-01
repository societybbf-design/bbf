'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const investmentJs = fs.readFileSync(path.join(__dirname, '../services/investmentService.js'), 'utf8');
const modelJs = fs.readFileSync(path.join(__dirname, '../models/Investment.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/investments.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const inboxJs = fs.readFileSync(path.join(__dirname, '../services/approvalsInboxService.js'), 'utf8');

test('Investment model supports capital expansion linkage and history', () => {
  assert.match(modelJs, /fundingKind/);
  assert.match(modelJs, /capital_expansion/);
  assert.match(modelJs, /parentInvestment/);
  assert.match(modelJs, /capitalExpansionHistory/);
  assert.match(modelJs, /expansionAppliedAt/);
});

test('proposeCapitalExpansion reuses createSocietyInvestment then applies after cashier payment', () => {
  assert.match(investmentJs, /async function proposeCapitalExpansion/);
  assert.match(investmentJs, /async function applyCompletedCapitalExpansion/);
  assert.match(investmentJs, /async function authorizeInvestmentByCeo/);
  assert.match(investmentJs, /fundingKind:\s*'capital_expansion'/);
  assert.match(investmentJs, /createSocietyInvestment\(\{/);
  assert.match(investmentJs, /pending_member_approval/);
  // Maker-checker: members → CEO authorization → cashier (not skip CEO).
  assert.match(investmentJs, /pending_ceo_authorization/);
  assert.match(investmentJs, /investment\.status = 'pending_ceo_authorization'/);
  // Cashier core funding path remains intact.
  assert.match(investmentJs, /const savingsUpdate = await fundInvestmentFromMembers\(investment\._id, societyFundingAmount\)/);
  assert.match(investmentJs, /getCashierPaymentFundingSnapshot/);
  assert.match(investmentJs, /hasMemberShortfall/);
  // Apply runs only after successful payment.
  assert.match(
    investmentJs,
    /await investment\.save\(\);[\s\S]*if \(investment\.fundingKind === 'capital_expansion'\)/
  );
  assert.match(investmentJs, /parent\.amount = moneyAmount\(Number\(parent\.amount \|\| 0\) \+ addAmount\)/);
  assert.match(investmentJs, /expansionInvestment\.status = 'closed'/);
});

test('expand-capital route is CEO/investments gated', () => {
  assert.match(routesJs, /proposeCapitalExpansion/);
  assert.match(routesJs, /\/:id\/expand-capital/);
  assert.match(routesJs, /requirePermission\('can_manage_investments'\)/);
  assert.match(routesJs, /requirePasswordConfirmation/);
  assert.match(routesJs, /\/:id\/ceo-authorize/);
  assert.match(routesJs, /authorizeInvestmentByCeo/);
});

test('CEO / member / cashier UIs surface capital expansion without rewriting payment core', () => {
  assert.match(adminHtml, /id="projectExpandCapitalForm"/);
  assert.match(adminHtml, /Expand Project Capital/);
  assert.match(adminJs, /function setProjectExpandTarget/);
  assert.match(adminJs, /expand-capital/);
  assert.match(adminJs, /data-expand-project/);
  assert.match(memberJs, /Approve Capital Expansion/);
  assert.match(memberJs, /isCapitalExpansion|fundingKind === 'capital_expansion'/);
  assert.match(staffJs, /Capital expansion →/);
  assert.match(staffJs, /Parent project capital updates after this payment/);
  assert.match(inboxJs, /Approve capital expansion/);
  assert.match(inboxJs, /Pay capital expansion/);
});
