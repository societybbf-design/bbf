'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const approvalsJs = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('Complete payment never uses window.confirm after funding check', () => {
  const beginIdx = staffJs.indexOf('async function beginCashierCompletePayment');
  assert.ok(beginIdx > 0);
  const beginSlice = staffJs.slice(beginIdx, beginIdx + 1200);
  assert.match(beginSlice, /canCompleteDirectly/);
  assert.match(beginSlice, /openCashierPaymentShortfallModal/);
  assert.doesNotMatch(beginSlice, /window\.confirm/);
  assert.match(staffJs, /Conditional Complete payment/);
});

test('payment popup is force-created and opened before any await', () => {
  assert.match(staffJs, /function ensureCashierPaymentShortfallModal/);
  assert.match(staffJs, /Force-create the Complete payment modal/);
  assert.match(staffJs, /Open the popup immediately \(before any await\)/);
  assert.match(staffJs, /modal\.style\.display = 'flex'/);
  assert.match(staffJs, /window\.ensureCashierPaymentShortfallModal/);
});

test('Approvals Complete payment resolves investment id from path or entityId', () => {
  assert.ok(approvalsJs.includes('pathMatch'));
  assert.ok(approvalsJs.includes('item.entityId'));
  assert.ok(approvalsJs.includes('Opening payment popup'));
  assert.ok(approvalsJs.includes('Payment popup is not loaded'));
  assert.ok(approvalsJs.includes('cashier-complete'));
});

test('Payment Queue waits for popup onDone and stringifies investment id', () => {
  const queueSlice = staffJs.slice(staffJs.indexOf('async function loadCashierQueue'));
  assert.match(queueSlice, /onDone:\s*\(done\)\s*=>\s*resolve/);
  assert.match(queueSlice, /String\(item\._id/);
});

test('staff page includes the payment popup modal markup', () => {
  assert.match(staffHtml, /id="cashierPaymentShortfallModal"/);
  assert.match(staffHtml, /id="cashierPaymentShortfallComplete"/);
});

test('HTML asset URLs are fingerprint-versioned so Complete payment JS cannot stick on 7d CDN cache', () => {
  assert.match(serverJs, /function computeAssetVersion/);
  assert.match(serverJs, /ASSET_VERSION/);
  assert.match(serverJs, /\?v=\$\{ASSET_VERSION\}/);
});

test('cashier investment approval details allow deposit managers (cashiers)', () => {
  const router = require('../routes/investments');
  const layer = router.stack.find((entry) => entry.route && entry.route.path === '/:id/approvals');
  assert.ok(layer, 'approvals route missing');
  const keys = [];
  layer.route.stack.forEach((step) => {
    if (typeof step.handle === 'function' && step.handle.length === 3) {
      // requirePermission closes over required keys — inspect by calling with mock
    }
  });
  // Source-level guarantee: deposits permission accepted alongside investments
  const src = fs.readFileSync(path.join(__dirname, '../routes/investments.js'), 'utf8');
  assert.match(
    src,
    /router\.get\(\s*'\/:id\/approvals'\s*,\s*requirePermission\(\s*'can_manage_investments'\s*,\s*'can_manage_deposits'\s*\)/
  );
});
