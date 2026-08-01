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

test('Loan table CSS beats page-section rules and forbids horizontal scroll', () => {
  // Higher specificity than .admin-dashboard .page-section .table-wrapper / .data-table
  assert.match(adminCss, /\.admin-dashboard \.page-section \.table-wrapper\.loan-admin-table-wrap/);
  assert.match(adminCss, /\.admin-dashboard \.page-section \.data-table\.loan-admin-table/);
  assert.match(adminCss, /table-layout:\s*fixed/);
  assert.match(adminCss, /table-wrapper\.loan-admin-table-wrap\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(adminCss, /text-overflow:\s*ellipsis/);
  assert.match(adminCss, /word-break:\s*keep-all/);
  assert.match(adminCss, /hyphens:\s*none/);
  assert.match(adminCss, /\.loan-action-btn/);
  assert.doesNotMatch(adminCss, /loan-applications-table\s*\{\s*min-width:\s*1120px/);
  assert.doesNotMatch(adminCss, /loan-repayments-table\s*\{\s*min-width:\s*980px/);
  assert.doesNotMatch(adminCss, /width:\s*max-content/);
});

test('Loan application and repayment rows render compact structured cells', () => {
  assert.match(adminJs, /async function loadLoanApplications/);
  assert.match(adminJs, /async function loadLoanRepayments/);
  assert.match(adminJs, /function formatLoanTableDateParts/);
  assert.match(adminJs, /function renderLoanTableDateCell/);
  assert.match(adminJs, /loan-col-member/);
  assert.match(adminJs, /loan-col-money/);
  assert.match(adminJs, /loan-col-reason/);
  assert.match(adminJs, /loan-col-action/);
  assert.match(adminJs, /loan-action-btn[\s\S]*Review/);
  assert.match(adminJs, /receipt-button loan-action-btn[\s\S]*Receipt/);
  assert.match(adminJs, /loan-cell-main/);
  assert.match(adminJs, /loan-cell-sub/);
  assert.match(adminJs, /renderLoanTableDateCell\(/);
});
