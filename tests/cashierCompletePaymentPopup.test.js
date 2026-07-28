'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const approvalsJs = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');

test('Complete payment always opens the popup (no silent confirm-only path)', () => {
  assert.match(staffJs, /async function beginCashierCompletePayment/);
  assert.match(staffJs, /Always open the payment popup/);
  assert.match(staffJs, /return openCashierPaymentShortfallModal/);
  assert.doesNotMatch(
    staffJs.slice(staffJs.indexOf('async function beginCashierCompletePayment')),
    /if \(check\.canComplete\)[\s\S]*window\.confirm/
  );
});

test('payment popup stays open on check failure and reports via onDone on close', () => {
  assert.match(staffJs, /Keep popup open so cashier can read the problem/);
  assert.match(staffJs, /closeCashierPaymentShortfallModal\(\{ completed: false, cancelled: true \}\)/);
  assert.match(staffJs, /onDone\(result\)/);
});

test('Approvals Complete payment waits for popup completion, not just open', () => {
  assert.match(approvalsJs, /Opening payment popup/);
  assert.match(approvalsJs, /onDone:\s*\(done\)\s*=>\s*resolve/);
  assert.match(approvalsJs, /Payment completed\./);
  assert.match(approvalsJs, /Payment popup closed/);
});

test('Payment Queue waits for popup onDone before finishing the click handler', () => {
  const queueSlice = staffJs.slice(staffJs.indexOf('async function loadCashierQueue'));
  assert.match(queueSlice, /onDone:\s*\(done\)\s*=>\s*resolve/);
  assert.match(queueSlice, /Payment popup closed/);
});

test('staff page includes the payment popup modal markup', () => {
  assert.match(staffHtml, /id="cashierPaymentShortfallModal"/);
  assert.match(staffHtml, /id="cashierPaymentShortfallComplete"/);
  assert.match(staffHtml, /z-index:9000/);
});
