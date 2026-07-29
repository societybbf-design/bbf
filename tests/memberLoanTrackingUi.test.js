'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

test('member loan tracking renders summary metric cards', () => {
  assert.match(memberJs, /function buildOutstandingLoanHtml/);
  assert.match(memberJs, /member-loan-summary-grid/);
  assert.match(memberJs, /Total Loan Amount/);
  assert.match(memberJs, /Total Repaid/);
  assert.match(memberJs, /Outstanding Balance \(Due\)/);
  assert.match(memberJs, /Funding Source/);
  assert.match(memberJs, /fundingSourceLabel/);
});

test('member loan tracking shows installment table with status badges', () => {
  assert.match(memberJs, /function formatInstallmentScheduleBadge/);
  assert.match(memberJs, /Installment #/);
  assert.match(memberJs, /Due Date/);
  assert.match(memberJs, /Amount Due/);
  assert.match(memberJs, /member-loan-status-paid/);
  assert.match(memberJs, /member-loan-status-active/);
  assert.match(memberJs, /member-loan-status-pending/);
  assert.match(memberJs, />Paid</);
  assert.match(memberJs, />Active</);
  assert.match(memberJs, />Pending</);
});

test('member loan tracking styles are present', () => {
  assert.match(stylesCss, /\.member-loan-summary-grid/);
  assert.match(stylesCss, /\.member-loan-status-paid/);
  assert.match(stylesCss, /\.member-loan-status-active/);
  assert.match(stylesCss, /\.member-loan-status-pending/);
});

test('member pages host the loan tracking containers', () => {
  assert.match(memberHtml, /dashboardOutstandingLoanContent/);
  assert.match(memberHtml, /loanOutstandingSummary/);
  assert.match(memberHtml, /Loan Tracking/);
});

test('member loan UI changes do not alter cashier repayment desk markup', () => {
  const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
  assert.match(staffHtml, /Loan Repayment Desk/);
  assert.match(staffHtml, /cashierLoanRepayAmount/);
});
