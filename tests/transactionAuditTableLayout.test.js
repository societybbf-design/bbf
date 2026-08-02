'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const cashierCss = fs.readFileSync(path.join(root, 'public/css/cashier-home.css'), 'utf8');

test('audit table markup uses dedicated wrap and column classes', () => {
  assert.match(staffHtml, /audit-table-wrap/);
  assert.match(staffHtml, /audit-data-table/);
  assert.match(staffHtml, /audit-col-direction/);
  assert.match(staffHtml, /audit-col-balance/);
  assert.match(staffHtml, /id="auditTransactionsTable"/);
});

test('audit row renderer sets data-label and cell classes for layout', () => {
  assert.match(staffJs, /audit-cell-amount/);
  assert.match(staffJs, /audit-cell-balance/);
  assert.match(staffJs, /data-label="Direction"/);
  assert.match(staffJs, /data-label="Balance after"/);
});

test('audit CSS prevents header shredding and enables horizontal scroll', () => {
  assert.match(cashierCss, /min-width:\s*1040px/);
  assert.match(cashierCss, /overflow-x:\s*auto/);
  assert.match(cashierCss, /white-space:\s*nowrap/);
  assert.match(cashierCss, /audit-data-table/);
  assert.doesNotMatch(
    cashierCss,
    /\[data-staff-view="audit"\] \.data-table th,\s*\[data-staff-view="audit"\] \.data-table td \{[\s\S]*?overflow-wrap:\s*anywhere/
  );
});
