'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'public/css/admin-dashboard.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const cashierCss = fs.readFileSync(path.join(root, 'public/css/cashier-home.css'), 'utf8');

test('CEO Reports page uses contained reports-page layout', () => {
  assert.match(adminHtml, /data-page-section="reports"/);
  assert.match(adminHtml, /class="page-section reports-page"/);
  assert.match(adminHtml, /reports-page-inner/);
  assert.match(adminHtml, /report-metrics-grid/);
  assert.match(adminHtml, /activity-log-table/);
  assert.match(adminHtml, /id="financialTrendChart"/);
});

test('Reports CSS constrains containers and sharpens text', () => {
  assert.match(adminCss, /\.admin-dashboard \.reports-page/);
  assert.match(adminCss, /max-width:\s*1100px/);
  assert.match(adminCss, /backdrop-filter:\s*none/);
  assert.match(adminCss, /\.admin-dashboard \.report-metrics-grid/);
  assert.match(adminCss, /overflow-x:\s*clip/);
  assert.match(adminCss, /\.activity-log-details/);
  assert.match(adminCss, /optimizeLegibility/);
});

test('Activity log renders wrapped details instead of raw code dump', () => {
  assert.match(adminJs, /formatActivityLogDetails/);
  assert.match(adminJs, /activity-log-details/);
  assert.match(adminJs, /activity-log-action/);
  assert.doesNotMatch(adminJs, /<code>\$\{escapeHtml\(JSON\.stringify\(item\.details/);
});

test('Staff reports panel uses compact report classes', () => {
  assert.match(staffHtml, /staff-reports-panel/);
  assert.match(staffHtml, /staff-reports-stats/);
  assert.match(cashierCss, /\.cashier-shell \.staff-reports-panel/);
  assert.match(cashierCss, /backdrop-filter:\s*none/);
});
