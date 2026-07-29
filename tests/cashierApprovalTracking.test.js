'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const serviceJs = fs.readFileSync(path.join(__dirname, '../services/approvalTrackingService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/approvals.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/cashier-home.css'), 'utf8');

test('approval tracking service is read-only aggregation', () => {
  assert.match(serviceJs, /async function getCashierApprovalTracking/);
  assert.match(serviceJs, /listLoanApprovalTracking/);
  assert.match(serviceJs, /listProjectApprovalTracking/);
  assert.match(serviceJs, /buildApprovalTrackingBatch/);
  assert.match(serviceJs, /pending_member_approval/);
  assert.match(serviceJs, /pending_cashier_payment/);
  assert.doesNotMatch(serviceJs, /\.save\(/);
  assert.doesNotMatch(serviceJs, /\.updateOne\(/);
  assert.doesNotMatch(serviceJs, /\.findOneAndUpdate\(/);
  assert.doesNotMatch(serviceJs, /approveInvestmentByMember/);
  assert.doesNotMatch(serviceJs, /updateLoanApplicationStatus/);
});

test('approvals tracking route is gated and read-only', () => {
  assert.match(routesJs, /\/tracking/);
  assert.match(routesJs, /getCashierApprovalTracking/);
  assert.match(routesJs, /can_disburse_loans/);
  assert.match(routesJs, /can_manage_deposits/);
  assert.doesNotMatch(routesJs, /router\.(post|patch|put|delete)\(\s*['"]\/tracking/);
});

test('cashier dashboard hosts approval tracking panel', () => {
  assert.match(staffHtml, /data-staff-view="approval-tracking"/);
  assert.match(staffHtml, /Approval Tracking/);
  assert.match(staffHtml, /read-only/i);
  assert.match(staffHtml, /approvalTrackingLoansList/);
  assert.match(staffHtml, /approvalTrackingProjectsList/);
  assert.match(staffHtml, /who has approved and who is still pending/i);
});

test('cashier JS renders approved vs pending breakdowns', () => {
  assert.match(staffJs, /loadStaffApprovalTracking/);
  assert.match(staffJs, /renderLoanApprovalTrackingCard/);
  assert.match(staffJs, /renderProjectApprovalTrackingCard/);
  assert.match(staffJs, /\/api\/approvals\/tracking/);
  assert.match(staffJs, /Not yet approved/);
  assert.match(staffJs, /approval-tracking/);
  assert.match(staffJs, /nav\.approvalTracking/);
});

test('approval tracking styles exist', () => {
  assert.match(css, /\.approval-track-card/);
  assert.match(css, /\.approval-track-person\.pending/);
  assert.match(css, /\.approval-track-person\.approved/);
});
