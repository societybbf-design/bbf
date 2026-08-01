'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'public/css/admin-dashboard.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('Member Hub modal markup uses dedicated size/scroll classes', () => {
  assert.match(adminHtml, /id="memberProfileModal"/);
  assert.match(adminHtml, /member-hub-modal-root/);
  assert.match(adminHtml, /member-hub-modal/);
  assert.match(adminHtml, /member-hub-modal-body/);
  assert.match(adminHtml, /id="memberProfileContent"/);
  assert.match(adminHtml, /admin\.sections\.memberHub/);
});

test('Member Hub CSS widens modal and scrolls body without horizontal overflow', () => {
  assert.match(adminCss, /#memberProfileModal \.member-hub-modal/);
  assert.match(adminCss, /width:\s*min\(1120px,\s*96vw\)/);
  assert.match(adminCss, /max-height:\s*min\(92vh,\s*920px\)/);
  assert.match(adminCss, /member-hub-modal-body[\s\S]*overflow-y:\s*auto/);
  assert.match(adminCss, /member-hub-modal-body[\s\S]*overflow-x:\s*hidden/);
  assert.match(adminCss, /member-profile-contact-grid[\s\S]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /member-profile-financial-grid[\s\S]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(adminCss, /profile-finance-card strong[\s\S]*text-overflow:\s*ellipsis/);
});

test('Member Hub content still renders profile grids and tabs', () => {
  assert.match(adminJs, /member-profile-shell-v2/);
  assert.match(adminJs, /member-profile-contact-grid/);
  assert.match(adminJs, /member-profile-financial-grid/);
  assert.match(adminJs, /profile-tabs-v2/);
  assert.match(adminJs, /data-profile-tab="loans"/);
  assert.match(adminJs, /data-profile-tab="messages"/);
});
