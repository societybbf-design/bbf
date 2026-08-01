'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modelJs = fs.readFileSync(path.join(root, 'models/Investment.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'services/externalInvestorPortalService.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');

test('Investment schema stores projectAsset and projectAssetCategory', () => {
  assert.match(modelJs, /projectAssetCategory:\s*\{/);
  assert.match(modelJs, /projectAsset:\s*\{/);
  assert.match(modelJs, /Exact asset \/ item/);
});

test('createSocietyInvestment persists project asset fields and capital expansion copies them', () => {
  assert.match(serviceJs, /projectAssetCategory\s*=\s*''/);
  assert.match(serviceJs, /projectAsset\s*=\s*''/);
  assert.match(serviceJs, /projectAssetCategory:\s*normalizedAssetCategory/);
  assert.match(serviceJs, /projectAsset:\s*normalizedAsset/);
  assert.match(serviceJs, /projectAssetCategory:\s*parent\.projectAssetCategory/);
  assert.match(serviceJs, /projectAsset:\s*parent\.projectAsset/);
});

test('investments create route accepts projectAsset fields', () => {
  assert.match(routesJs, /projectAssetCategory/);
  assert.match(routesJs, /projectAsset:/);
});

test('Create Project form keeps Investment Type and Return Type unchanged and adds asset fields', () => {
  // Existing controls remain.
  assert.match(adminHtml, /name="investmentType"\s+id="projectTypeSelect"/);
  assert.match(adminHtml, /name="returnMode"\s+id="projectReturnMode"/);
  assert.match(adminHtml, /option value="fixed_term"/);
  assert.match(adminHtml, /option value="monthly"/);
  // New asset controls.
  assert.match(adminHtml, /id="projectAssetCategory"/);
  assert.match(adminHtml, /id="projectAssetName"/);
  assert.match(adminHtml, /name="projectAsset"/);
  assert.match(adminHtml, /Livestock/);
  assert.match(adminHtml, /Vehicles/);
});

test('admin create payload and project lists surface asset details', () => {
  assert.match(adminJs, /projectAssetCategory:\s*String\(formData\.get\('projectAssetCategory'\)/);
  assert.match(adminJs, /projectAsset:\s*String\(formData\.get\('projectAsset'\)/);
  assert.match(adminJs, /function projectAssetLabel/);
  assert.match(adminJs, /projectAssetLabel\(item\)/);
});

test('external investor portal includes project asset fields', () => {
  assert.match(portalJs, /projectAsset/);
  assert.match(portalJs, /projectAssetCategory/);
  assert.match(staffJs, /projectAssetCategory/);
});
