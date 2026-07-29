'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('member loan tracking renders summary metric cards', () => {
  assert.match(memberJs, /function buildOutstandingLoanHtml/);
  assert.match(memberJs, /member-loan-summary-grid/);
  assert.match(memberJs, /Total Loan Amount/);
  assert.match(memberJs, /Total Paid So Far/);
  assert.match(memberJs, /Remaining Due Balance/);
  assert.match(memberJs, /Funding Source/);
  assert.match(memberJs, /fundingSourceLabel/);
});

test('member loan tracking does not render installment schedules', () => {
  assert.doesNotMatch(memberJs, /function formatInstallmentScheduleBadge/);
  assert.doesNotMatch(memberJs, /Installment Schedule/);
  assert.doesNotMatch(memberJs, /member-loan-installment-table/);
  assert.doesNotMatch(memberJs, /suggestedInstallment/);
  assert.doesNotMatch(memberHtml, /installment schedule/i);
});

test('member loan tracking styles keep summary cards without schedule table styles', () => {
  assert.match(stylesCss, /\.member-loan-summary-grid/);
  assert.doesNotMatch(stylesCss, /\.member-loan-installment-table/);
  assert.doesNotMatch(stylesCss, /\.member-loan-schedule-header/);
});

test('member pages host the loan tracking containers', () => {
  assert.match(memberHtml, /dashboardOutstandingLoanContent/);
  assert.match(memberHtml, /loanOutstandingSummary/);
  assert.match(memberHtml, /Loan Tracking/);
});

test('cashier repayment desk shows summary metrics without installment table', () => {
  assert.match(staffHtml, /Loan Repayment Desk/);
  assert.match(staffHtml, /cashierLoanRepayAmount/);
  assert.match(staffHtml, /cashierLoanDetailFunding/);
  assert.doesNotMatch(staffHtml, /cashierLoanScheduleBody/);
  assert.doesNotMatch(staffHtml, /Suggested installment/);
  assert.doesNotMatch(staffJs, /renderCashierLoanSchedule/);
  assert.doesNotMatch(staffJs, /suggestedInstallment/);
});
