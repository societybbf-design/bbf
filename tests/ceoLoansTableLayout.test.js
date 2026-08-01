'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'public/css/admin-dashboard.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('CEO loan tables use dedicated layout classes', () => {
  assert.match(adminHtml, /loan-admin-table-card/);
  assert.match(adminHtml, /loan-admin-table-wrap/);
  assert.match(adminHtml, /loan-applications-table/);
  assert.match(adminHtml, /loan-repayments-table/);
  assert.match(adminHtml, /class="loan-col-action"/);
  assert.match(adminHtml, /class="loan-col-money"/);
});

test('Loan table CSS overrides wrap/hyphen shredding and keeps action labels intact', () => {
  assert.match(adminCss, /\.admin-dashboard \.loan-admin-table/);
  assert.match(adminCss, /overflow-wrap:\s*normal/);
  assert.match(adminCss, /word-break:\s*keep-all/);
  assert.match(adminCss, /hyphens:\s*none/);
  assert.match(adminCss, /\.loan-action-btn/);
  assert.match(adminCss, /white-space:\s*nowrap/);
  assert.match(adminCss, /min-width:\s*1120px/);
  assert.match(adminCss, /min-width:\s*980px/);
  assert.match(adminCss, /loan-admin-table-wrap[\s\S]*overflow-x:\s*auto/);
});

test('Loan application and repayment rows render structured cells and action buttons', () => {
  assert.match(adminJs, /async function loadLoanApplications/);
  assert.match(adminJs, /async function loadLoanRepayments/);
  assert.match(adminJs, /loan-col-member/);
  assert.match(adminJs, /loan-col-money/);
  assert.match(adminJs, /loan-col-reason/);
  assert.match(adminJs, /loan-col-action/);
  assert.match(adminJs, /loan-action-btn[\s\S]*Review/);
  assert.match(adminJs, /receipt-button loan-action-btn[\s\S]*Receipt/);
  assert.match(adminJs, /loan-cell-main/);
  assert.match(adminJs, /loan-cell-sub/);
});
