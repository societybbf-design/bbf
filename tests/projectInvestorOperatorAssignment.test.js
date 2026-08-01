'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const investmentModel = fs.readFileSync(path.join(root, 'models/Investment.js'), 'utf8');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('Investment schema documents investor operator and projectManager links', () => {
  assert.match(investmentModel, /Assigned Investor \/ Operator/);
  assert.match(investmentModel, /Supervising Project Manager/);
  assert.match(investmentModel, /investor:\s*\{/);
  assert.match(investmentModel, /projectManager:\s*\{/);
  assert.match(investmentModel, /externalInvestors/);
});

test('createSocietyInvestment resolves operator as role investor separately from external co-funders', () => {
  assert.match(investmentService, /Assign an Investor \/ Operator who will run this project/);
  assert.match(
    investmentService,
    /investorUser = await User\.findOne\(\{[\s\S]*role:\s*'investor'/
  );
  assert.match(
    investmentService,
    /Operator link stays on investor; external co-funders live only in externalInvestors/
  );
  assert.match(
    investmentService,
    /investor:\s*investorUser\?\.\_id \|\| null/
  );
  assert.doesNotMatch(
    investmentService,
    /investor:\s*primaryExternal\?\.investor \|\| investorUser/
  );
  assert.match(
    investmentService,
    /Operator \(investorId\) never becomes an ownership stake/
  );
});

test('Create Project form assigns investor operator from registered investors pool', () => {
  assert.match(adminHtml, /id="projectOperatorSelect"/);
  assert.match(adminHtml, /name="investorId"/);
  assert.match(adminHtml, /Assign Investor \/ Operator/);
  assert.match(adminHtml, /id="projectManagerSelect"/);
  assert.match(adminHtml, /name="projectManagerId"/);
  assert.match(adminJs, /projectOperatorSelect/);
  assert.match(adminJs, /fillSelectOptions\(document\.getElementById\('projectOperatorSelect'\)/);
  assert.match(adminJs, /investmentFormOptions\.investors/);
  assert.match(adminJs, /investorId:\s*formData\.get\('investorId'\)/);
  assert.doesNotMatch(
    adminJs,
    /investorId:\s*externalInvestors\[0\]\?\.investorId/
  );
  assert.match(adminJs, /Assign an Investor \/ Operator who will run this project/);
});

test('Open projects table shows operator and project manager', () => {
  assert.match(adminJs, /operatorLabel/);
  assert.match(adminJs, /PM: \$\{escapeHtml\(pmLabel\)\}/);
  assert.match(adminHtml, /table\.investorOperator/);
});
