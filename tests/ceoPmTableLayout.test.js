'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'public/css/admin-dashboard.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('CEO Project Management tables use dedicated layout classes', () => {
  assert.match(adminHtml, /pm-admin-table-card/);
  assert.match(adminHtml, /pm-admin-table-wrap/);
  assert.match(adminHtml, /pm-open-table/);
  assert.match(adminHtml, /pm-closed-table/);
  assert.match(adminHtml, /class="pm-col-actions"/);
  assert.match(adminHtml, /class="pm-col-ownership"/);
  assert.match(adminHtml, /id="projectsOpenList"/);
  assert.match(adminHtml, /id="projectsClosedList"/);
});

test('PM table CSS beats page-section wrap rules and keeps action buttons intact', () => {
  assert.match(adminCss, /\.admin-dashboard \.page-section \.table-wrapper\.pm-admin-table-wrap/);
  assert.match(adminCss, /\.admin-dashboard \.page-section \.data-table\.pm-admin-table/);
  assert.match(adminCss, /table-layout:\s*fixed/);
  assert.match(adminCss, /table-wrapper\.pm-admin-table-wrap\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(adminCss, /text-overflow:\s*ellipsis/);
  assert.match(adminCss, /\.pm-action-stack/);
  assert.match(adminCss, /\.pm-action-btn/);
  assert.match(adminCss, /word-break:\s*keep-all/);
  assert.match(adminCss, /hyphens:\s*none/);
  assert.doesNotMatch(adminCss, /\.pm-admin-table[^{]*\{[^}]*width:\s*max-content/);
});

test('Open and settled project rows render structured cells and action stack', () => {
  assert.match(adminJs, /async function loadProjectsModule/);
  assert.match(adminJs, /pm-col-id/);
  assert.match(adminJs, /pm-col-investor/);
  assert.match(adminJs, /pm-col-ownership/);
  assert.match(adminJs, /pm-col-actions/);
  assert.match(adminJs, /pm-action-stack/);
  assert.match(adminJs, /pm-action-btn[\s\S]*Expand capital/);
  assert.match(adminJs, /pm-action-btn[\s\S]*Liquidate/);
  assert.match(adminJs, /pm-cell-main/);
  assert.match(adminJs, /pm-status-badge/);
  assert.match(adminJs, /pm-net-positive/);
  assert.match(adminJs, /Society only/);
  assert.match(adminJs, /compact:\s*true/);
  assert.match(adminJs, /Fixed \/ Term/);
});
