'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');

test('CEO sidebar MANAGEMENT includes External Investors link below Members', () => {
  const managementIdx = adminHtml.indexOf('data-i18n="nav.section.management"');
  const investorsIdx = adminHtml.indexOf('data-page="investors"');
  const pmIdx = adminHtml.indexOf('data-page="project-managers"');
  const membersIdx = adminHtml.indexOf('data-page="members"');
  const externalIdx = adminHtml.indexOf('data-page="external-investors"');
  const messagesIdx = adminHtml.indexOf('data-page="messages"');

  assert.ok(managementIdx > 0);
  assert.ok(investorsIdx > managementIdx);
  assert.ok(pmIdx > investorsIdx);
  assert.ok(membersIdx > pmIdx);
  assert.ok(externalIdx > membersIdx, 'External Investors should sit below Members in Management');
  assert.ok(messagesIdx > externalIdx, 'Messages should remain after External Investors');
  assert.match(adminHtml, /data-i18n="nav\.externalInvestors">External Investors</);
  assert.match(adminHtml, /href="#external-investors"/);
});

test('External Investors page section and management detail exist', () => {
  assert.match(adminHtml, /data-page-section="external-investors"/);
  assert.match(adminHtml, /id="externalInvestorsModuleList"/);
  assert.match(adminHtml, /id="externalInvestorDetailPanel"/);
  assert.match(adminHtml, /id="backToExternalInvestorsBtn"/);
});

test('admin JS routes to External Investors module and portfolio detail', () => {
  assert.match(adminJs, /case 'external-investors':/);
  assert.match(adminJs, /loadExternalInvestorsModule/);
  assert.match(adminJs, /openExternalInvestorDetail/);
  assert.match(adminJs, /\/api\/admin\/investments\/external-investors\/\$\{investorId\}\/portfolio/);
  assert.match(adminJs, /Project ownership shares/);
  assert.match(adminJs, /Capital deposits/);
  assert.match(adminJs, /Returns &amp; profit activity|Returns \& profit activity/);
});

test('API and deep-link routes expose external investor portfolio', () => {
  assert.match(routesJs, /external-investors\/:investorId\/portfolio/);
  assert.match(routesJs, /getExternalInvestorPortfolio/);
  assert.match(serviceJs, /async function getExternalInvestorPortfolio/);
  assert.match(serverJs, /\/admin\/external-investors\/:investorId/);
});
