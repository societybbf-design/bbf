'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMemberShares } = require('../services/profitService');
const { money } = require('../services/emergencyReserveService');

test('money helper rounds to two decimals', () => {
  assert.equal(money(10.456), 10.46);
  assert.equal(money(null), 0);
});

test('reserve shares split equally among active members (equal-share society)', () => {
  const members = [
    { _id: 'a', name: 'A', savings: 7000, profit: 0 },
    { _id: 'b', name: 'B', savings: 3000, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 1000, 'proportional');
  assert.equal(shares.length, 2);
  assert.equal(shares[0].amount, 500);
  assert.equal(shares[1].amount, 500);
});

test('equal fallback when all weights are zero', () => {
  const members = [
    { _id: 'a', name: 'A', savings: 0, profit: 0 },
    { _id: 'b', name: 'B', savings: 0, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 100, 'proportional');
  assert.equal(shares[0].amount, 50);
  assert.equal(shares[1].amount, 50);
});

test('emergency reserve routes module exports a router', () => {
  const router = require('../routes/emergencyReserve');
  assert.equal(typeof router, 'function');
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path).sort();
  assert.deepEqual(paths, ['/', '/allocate', '/cover-contribution/:id', '/member-shares']);
});
