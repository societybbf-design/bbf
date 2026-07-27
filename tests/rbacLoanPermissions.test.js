const test = require('node:test');
const assert = require('node:assert/strict');
const {
  userHasPermission,
  getDefaultPermissions,
  publicUserPayload,
  CASHIER_EXCLUSIVE_PERMISSIONS,
} = require('../services/rbac');

test('can_disburse_loans is cashier-exclusive', () => {
  assert.deepEqual(CASHIER_EXCLUSIVE_PERMISSIONS, ['can_disburse_loans']);
  assert.equal(userHasPermission({ role: 'cashier', permissions: [] }, 'can_disburse_loans'), true);
  assert.equal(userHasPermission({ role: 'ceo', permissions: ['can_disburse_loans'] }, 'can_disburse_loans'), false);
  assert.equal(userHasPermission({ role: 'admin' }, 'can_disburse_loans'), false);
  assert.equal(userHasPermission({ role: 'developer' }, 'can_disburse_loans'), false);
  assert.equal(userHasPermission({ role: 'project_manager' }, 'can_disburse_loans'), false);
});

test('CEO retains loan review but not disbursement defaults', () => {
  const ceo = getDefaultPermissions('ceo');
  assert.equal(ceo.includes('can_manage_loans'), true);
  assert.equal(ceo.includes('can_disburse_loans'), false);
});

test('Cashier defaults include disbursement only (no approve permission)', () => {
  const cashier = getDefaultPermissions('cashier');
  assert.equal(cashier.includes('can_disburse_loans'), true);
  assert.equal(cashier.includes('can_manage_loans'), false);
});

test('Project manager no longer reviews loans by default', () => {
  const pm = getDefaultPermissions('project_manager');
  assert.equal(pm.includes('can_manage_loans'), false);
  assert.equal(pm.includes('can_disburse_loans'), false);
});

test('publicUserPayload strips disbursement from CEO and grants it to cashier', () => {
  const ceoPayload = publicUserPayload({
    _id: '1',
    email: 'ceo@example.com',
    role: 'ceo',
    name: 'CEO',
    permissions: ['can_disburse_loans', 'can_manage_loans'],
  });
  assert.equal(ceoPayload.permissions.includes('can_disburse_loans'), false);
  assert.equal(ceoPayload.permissions.includes('can_manage_loans'), true);

  const cashierPayload = publicUserPayload({
    _id: '2',
    email: 'cashier@example.com',
    role: 'cashier',
    name: 'Cashier',
    permissions: ['can_manage_deposits'],
  });
  assert.equal(cashierPayload.permissions.includes('can_disburse_loans'), true);
});
