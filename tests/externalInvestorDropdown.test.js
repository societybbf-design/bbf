'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_ROLES,
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  getDefaultPermissions,
  dashboardPathForRole,
} = require('../services/rbac');

const root = path.join(__dirname, '..');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const umHtml = fs.readFileSync(path.join(root, 'views/user-management.html'), 'utf8');
const developerJs = fs.readFileSync(path.join(root, 'public/js/developer.js'), 'utf8');

test('external_investor is a distinct assignable role', () => {
  assert.ok(ALL_ROLES.includes('external_investor'));
  assert.ok(ASSIGNABLE_ROLES.includes('external_investor'));
  assert.equal(ROLE_LABELS.external_investor, 'External Investor');
  assert.deepEqual(getDefaultPermissions('external_investor'), ['can_view_reports', 'can_manage_chat']);
  assert.equal(dashboardPathForRole('external_investor'), '/dashboard/investor');
  assert.notEqual(ROLE_LABELS.investor, ROLE_LABELS.external_investor);
});

test('listExternalInvestorUsers filters role external_investor only', () => {
  assert.match(investmentService, /async function listExternalInvestorUsers/);
  assert.match(
    investmentService,
    /async function listExternalInvestorUsers\(\) \{[\s\S]*role:\s*'external_investor'/
  );
  assert.match(
    investmentService,
    /async function listInvestorUsers\(\) \{[\s\S]*role:\s*'investor'/
  );
});

test('createSocietyInvestment rejects internal investor role for co-funding stakes', () => {
  assert.match(
    investmentService,
    /role:\s*'external_investor'[\s\S]*Internal Investors cannot be used/
  );
  assert.match(investmentService, /User Management \(External Investors tab\)/);
});

test('API exposes dedicated external-investors endpoint', () => {
  assert.match(routesJs, /\/external-investors/);
  assert.match(routesJs, /listExternalInvestorUsers/);
});

test('Create Project dropdown loads external investors only', () => {
  assert.match(adminJs, /\/api\/admin\/investments\/external-investors/);
  assert.match(adminJs, /externalInvestors:\s*externalInvestorsData\.investors/);
  assert.match(adminJs, /investmentFormOptions\.externalInvestors/);
  assert.match(adminJs, /Choose external investor/);
  const optionsFn = adminJs.match(
    /function investorOptionsHtml\(selectedId = ''\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  assert.match(optionsFn, /investmentFormOptions\.externalInvestors/);
  assert.doesNotMatch(optionsFn, /investmentFormOptions\.investors/);
  assert.match(adminHtml, /External Investors/);
  assert.match(adminHtml, /Investor \/ Operator and Project Manager assigned above are not listed/);
});

test('User Management exposes External Investors tab for registration', () => {
  assert.match(umHtml, /data-um-role-tab="external_investor"/);
  assert.match(developerJs, /id:\s*'external_investor'/);
  assert.match(developerJs, /roles:\s*\['external_investor'\]/);
});
