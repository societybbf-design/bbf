'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateRefundAvailability,
  createRefund,
  isAwaitingCashierPayout,
} = require('../services/refundService');
const {
  userHasPermission,
  getDefaultPermissions,
  publicUserPayload,
  CASHIER_EXCLUSIVE_PERMISSIONS,
} = require('../services/rbac');

const root = path.join(__dirname, '..');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(root, 'public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(root, 'views/member.html'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const memberRoutes = fs.readFileSync(path.join(root, 'routes/member.js'), 'utf8');
const refundService = fs.readFileSync(path.join(root, 'services/refundService.js'), 'utf8');
const refundModel = fs.readFileSync(path.join(root, 'models/Refund.js'), 'utf8');
const ledgerModel = fs.readFileSync(path.join(root, 'models/BankLedgerEntry.js'), 'utf8');
const inboxService = fs.readFileSync(path.join(root, 'services/approvalsInboxService.js'), 'utf8');

test('calculateRefundAvailability respects open holds', () => {
  const ok = calculateRefundAvailability({
    savings: 2500,
    pendingAmount: 400,
    requestedAmount: 900,
  });
  assert.equal(ok.availableAmount, 2100);
  assert.equal(ok.canRequest, true);
  assert.equal(ok.remainingAfterRequest, 1200);

  const blocked = calculateRefundAvailability({
    savings: 500,
    pendingAmount: 300,
    requestedAmount: 400,
  });
  assert.equal(blocked.canRequest, false);
  assert.equal(blocked.availableAmount, 200);
});

test('legacy processing status awaits cashier payout', () => {
  assert.equal(isAwaitingCashierPayout('approved'), true);
  assert.equal(isAwaitingCashierPayout('processing'), true);
  assert.equal(isAwaitingCashierPayout('pending'), false);
  assert.equal(isAwaitingCashierPayout('completed'), false);
});

test('direct staff createRefund is disabled', async () => {
  await assert.rejects(
    () => createRefund(),
    (error) => error.status === 403
  );
});

test('can_disburse_refunds is cashier-exclusive; CEO keeps review only', () => {
  assert.ok(CASHIER_EXCLUSIVE_PERMISSIONS.includes('can_disburse_refunds'));
  assert.equal(userHasPermission({ role: 'cashier', permissions: [] }, 'can_disburse_refunds'), true);
  assert.equal(userHasPermission({ role: 'ceo', permissions: ['can_disburse_refunds'] }, 'can_disburse_refunds'), false);
  assert.equal(getDefaultPermissions('ceo').includes('can_manage_refunds'), true);
  assert.equal(getDefaultPermissions('ceo').includes('can_disburse_refunds'), false);
  assert.equal(getDefaultPermissions('cashier').includes('can_disburse_refunds'), true);
  assert.equal(getDefaultPermissions('cashier').includes('can_manage_refunds'), false);

  const cashierPayload = publicUserPayload({
    _id: 'c1',
    email: 'cashier@example.com',
    role: 'cashier',
    name: 'Cashier',
    permissions: ['can_manage_refunds', 'can_manage_deposits'],
  });
  assert.equal(cashierPayload.permissions.includes('can_disburse_refunds'), true);
  assert.equal(cashierPayload.permissions.includes('can_manage_refunds'), false);

  const ceoPayload = publicUserPayload({
    _id: 'ceo1',
    email: 'ceo@example.com',
    role: 'ceo',
    name: 'CEO',
    permissions: ['can_disburse_refunds', 'can_manage_refunds'],
  });
  assert.equal(ceoPayload.permissions.includes('can_disburse_refunds'), false);
  assert.equal(ceoPayload.permissions.includes('can_manage_refunds'), true);
});

test('refund model and ledger support maker-checker payout', () => {
  assert.match(refundModel, /pending.*approved.*rejected.*completed.*processing/s);
  assert.match(refundModel, /requestedBy/);
  assert.match(refundModel, /bankLedgerEntryId/);
  assert.match(ledgerModel, /member_refund/);
  assert.match(refundService, /createMemberRefundRequest/);
  assert.match(refundService, /async function approveRefund/);
  assert.match(refundService, /async function rejectRefund/);
  assert.match(refundService, /async function processRefundPayout/);
  assert.match(refundService, /type:\s*'member_refund'/);
  assert.match(refundService, /withMongoTransaction/);
});

test('admin routes expose CEO review and Cashier payout endpoints', () => {
  assert.match(adminRoutes, /router\.post\('\/refunds\/:id\/approve'/);
  assert.match(adminRoutes, /router\.post\('\/refunds\/:id\/reject'/);
  assert.match(adminRoutes, /router\.post\('\/refunds\/:id\/cashier-complete'/);
  assert.match(adminRoutes, /router\.get\('\/refunds\/cashier-queue'/);
  assert.match(adminRoutes, /Direct staff refund creation is disabled/);
  assert.match(memberRoutes, /router\.post\('\/refunds'/);
  assert.match(memberRoutes, /createMemberRefundRequest/);
});

test('CEO profile UI removes Record Refund and only allows approve/reject', () => {
  assert.doesNotMatch(adminJs, /Record Refund/);
  assert.doesNotMatch(adminJs, /profile-refund-form/);
  assert.doesNotMatch(adminJs, /data-next-status="completed"/);
  assert.match(adminJs, /data-refund-approve/);
  assert.match(adminJs, /data-refund-reject/);
  assert.match(adminJs, /Awaiting Cashier payout/);
});

test('member dashboard can submit refund requests', () => {
  assert.match(memberHtml, /id="refundRequestForm"/);
  assert.match(memberHtml, /Request a Refund/);
  assert.match(memberJs, /\/api\/member\/refunds/);
  assert.match(memberJs, /Awaiting CEO review|Pending CEO review/);
});

test('cashier refund module is payout queue only', () => {
  assert.doesNotMatch(staffHtml, /id="cashierRefundForm"/);
  assert.doesNotMatch(staffHtml, /Create refund/);
  assert.match(staffHtml, /id="cashierRefundsBody"/);
  assert.match(staffHtml, /Refund Payouts/);
  assert.match(staffJs, /can_disburse_refunds/);
  assert.match(staffJs, /\/api\/admin\/refunds\/cashier-queue/);
  assert.match(staffJs, /data-cashier-pay-refund/);
  assert.match(staffJs, /cashier-complete/);
});

test('approvals inbox wires CEO approve/reject and Cashier payout', () => {
  assert.match(inboxService, /can_manage_refunds/);
  assert.match(inboxService, /can_disburse_refunds/);
  assert.match(inboxService, /\/api\/admin\/refunds\/\$\{refund\._id\}\/approve/);
  assert.match(inboxService, /\/api\/admin\/refunds\/\$\{refund\._id\}\/reject/);
  assert.match(inboxService, /\/api\/admin\/refunds\/\$\{refund\._id\}\/cashier-complete/);
});
