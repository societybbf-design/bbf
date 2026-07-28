const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertProxyActor,
} = require('../services/memberApprovalProxyService');

test('assertProxyActor allows developer role', () => {
  assert.doesNotThrow(() => assertProxyActor({ role: 'developer', name: 'UM Admin' }));
});

test('assertProxyActor allows explicit can_proxy_member_approvals permission', () => {
  assert.doesNotThrow(() => assertProxyActor({
    role: 'ceo',
    permissions: ['can_proxy_member_approvals'],
    name: 'CEO',
  }));
});

test('assertProxyActor rejects CEO without proxy permission', () => {
  assert.throws(
    () => assertProxyActor({ role: 'ceo', permissions: [], name: 'CEO' }),
    (error) => error.status === 403
  );
});

test('assertProxyActor rejects missing actor', () => {
  assert.throws(
    () => assertProxyActor(null),
    (error) => error.status === 401
  );
});
