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

test('developer-only wipe API requires phrase, password, and strict developer role', () => {
  assert.match(developerRoutes, /\/database\/wipe/);
  assert.match(developerRoutes, /requireStrictDeveloper/);
  assert.match(developerRoutes, /requirePasswordConfirmation/);
  assert.match(developerRoutes, /WIPE_CONFIRM_PHRASE/);
  assert.match(developerRoutes, /wipeTransactionalDatabase/);
  assert.match(developerRoutes, /Only the platform Developer account/);
});

test('User Management Danger Zone UI wires wipe form', () => {
  assert.match(umHtml, /umDatabaseWipeForm/);
  assert.match(umHtml, /WIPE_ALL_DATA/);
  assert.match(umHtml, /data-dev-panel="danger"/);
  assert.match(developerJs, /\/api\/developer\/database\/wipe/);
  assert.match(developerJs, /SEED_ONLY_DEVELOPER/);
});
