'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resetService = fs.readFileSync(path.join(root, 'services/databaseResetService.js'), 'utf8');
const resetScript = fs.readFileSync(path.join(root, 'scripts/reset-database.js'), 'utf8');
const developerRoutes = fs.readFileSync(path.join(root, 'routes/developer.js'), 'utf8');
const umHtml = fs.readFileSync(path.join(root, 'views/user-management.html'), 'utf8');
const developerJs = fs.readFileSync(path.join(root, 'public/js/developer.js'), 'utf8');

test('wipe service preserves developer role and reseeds basics', () => {
  assert.match(resetService, /role:\s*'developer'/);
  assert.match(resetService, /dropCollection/);
  assert.match(resetService, /WIPE_ALL_DATA/);
  assert.match(resetService, /ensureDeveloperUser/);
  assert.match(resetService, /ensureDefaultInvestmentTypes/);
  assert.match(resetScript, /wipeTransactionalDatabase/);
});

test('Danger Zone database-wipe module is removed from the User Management dashboard', () => {
  // The dashboard-facing wipe module (nav item, panel, JS handler, and HTTP endpoint)
  // was intentionally removed. Destructive wipes remain available only via the
  // CLI (`npm run db:reset:confirm`) which uses services/databaseResetService.js.
  assert.doesNotMatch(developerRoutes, /\/database\/wipe/);
  assert.doesNotMatch(developerRoutes, /requireStrictDeveloper/);
  assert.doesNotMatch(umHtml, /umDatabaseWipeForm/);
  assert.doesNotMatch(umHtml, /data-dev-panel="danger"/);
  assert.doesNotMatch(umHtml, /data-dev-tab="danger"/);
  assert.doesNotMatch(developerJs, /\/api\/developer\/database\/wipe/);
});
