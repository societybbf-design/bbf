'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getApprovalsInbox,
  getApprovalsCounts,
} = require('../services/approvalsInboxService');

test('getApprovalsInbox requires authentication', async () => {
  await assert.rejects(
    () => getApprovalsInbox(null),
    (error) => error.status === 401
  );
});

test('getApprovalsCounts requires authentication', async () => {
  await assert.rejects(
    () => getApprovalsCounts(undefined),
    (error) => error.status === 401
  );
});

test('approvals routes module exports a router', () => {
  const router = require('../routes/approvals');
  assert.equal(typeof router, 'function');
  assert.ok(Array.isArray(router.stack));
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path)
    .sort();
  assert.deepEqual(paths, ['/counts', '/inbox', '/tracking']);
});
