'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resetScript = fs.readFileSync(path.join(root, 'scripts/reset-database.js'), 'utf8');
const seedService = fs.readFileSync(path.join(root, 'services/seedService.js'), 'utf8');
const securityService = fs.readFileSync(path.join(root, 'services/securityService.js'), 'utf8');
const passwordConfirm = fs.readFileSync(path.join(root, 'public/js/password-confirm.js'), 'utf8');
const investmentRoutes = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const financeService = fs.readFileSync(path.join(root, 'services/projectFinanceService.js'), 'utf8');
const analyticsRoutes = fs.readFileSync(path.join(root, 'routes/analytics.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const memberHtml = fs.readFileSync(path.join(root, 'views/member.html'), 'utf8');

test('reset-database script preserves developer role and requires confirm', () => {
  assert.match(resetScript, /role:\s*'developer'/);
  assert.match(resetScript, /--confirm/);
  assert.match(resetScript, /dropCollection/);
  assert.match(resetScript, /Preserving/);
  assert.equal(typeof packageJson.scripts['db:reset:confirm'], 'string');
});

test('seed defaults to developer-only; CEO/member are opt-in', () => {
  assert.match(seedService, /SEED_ONLY_DEVELOPER/);
  assert.match(seedService, /ensureDeveloperUser/);
  assert.match(seedService, /SEED_CEO/);
  assert.match(seedService, /SEED_MEMBER/);
  assert.match(envExample, /SEED_ONLY_DEVELOPER=1/);
});

test('developer role requires password confirmation on sensitive actions', () => {
  assert.match(securityService, /'developer'/);
  assert.match(securityService, /rolesRequiringPasswordConfirm/);
  assert.doesNotMatch(passwordConfirm, /startsWith\('\/api\/developer\/'\)/);
});

test('investment create/update/delete/expand require CEO', () => {
  assert.match(investmentRoutes, /router\.post\('\/',\s*requireCeo/);
  assert.match(investmentRoutes, /expand-capital',\s*requireCeo/);
  assert.match(investmentRoutes, /router\.put\('\/:id',\s*requireCeo/);
  assert.match(investmentRoutes, /router\.delete\('\/:id',\s*requireCeo/);
  assert.match(investmentService, /Cannot delete a funded or closed project/);
});

test('external capital queue supports partial deposits', () => {
  assert.match(financeService, /remaining/);
  assert.match(financeService, /\$expr/);
  assert.match(financeService, /externalCapitalReceived/);
});

test('member trends endpoint scopes non-self access by permission', () => {
  assert.match(analyticsRoutes, /can_manage_members/);
  assert.match(analyticsRoutes, /can_view_reports/);
  assert.match(analyticsRoutes, /isSelf/);
});

test('member dashboard exposes total invested KPI element', () => {
  assert.match(memberHtml, /id="memberTotalInvested"/);
});

test('orphan ceo/developer HTML shells are removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'views/ceo.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/js/ceo.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'views/developer.html')), false);
});
