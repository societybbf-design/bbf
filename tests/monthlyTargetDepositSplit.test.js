'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeMonthlyDepositSplit,
} = require('../services/monthlyTargetService');

test('deposit of 10000 against remaining 5000 target splits 5000 fixed + 5000 advance', () => {
  const split = computeMonthlyDepositSplit(10000, 5000, 5000);
  assert.equal(split.splitApplied, true);
  assert.equal(split.towardTarget, 5000);
  assert.equal(split.surplus, 5000);
  assert.equal(split.remainingUnpaid, 0);
});

test('partial prior payment reduces fixed portion and keeps surplus as advance', () => {
  // Target 5000, already paid 2000 → remaining 3000; deposit 8000
  const split = computeMonthlyDepositSplit(8000, 3000, 5000);
  assert.equal(split.towardTarget, 3000);
  assert.equal(split.surplus, 5000);
  assert.equal(split.remainingUnpaid, 0);
});

test('shortfall stays on unpaid dues with no advance surplus', () => {
  const split = computeMonthlyDepositSplit(2000, 5000, 5000);
  assert.equal(split.towardTarget, 2000);
  assert.equal(split.surplus, 0);
  assert.equal(split.remainingUnpaid, 3000);
});

test('fully paid month sends entire deposit to advance', () => {
  const split = computeMonthlyDepositSplit(10000, 0, 5000);
  assert.equal(split.towardTarget, 0);
  assert.equal(split.surplus, 10000);
  assert.equal(split.remainingUnpaid, 0);
});

test('no configured target skips split and keeps full amount as regular', () => {
  const split = computeMonthlyDepositSplit(10000, 0, null);
  assert.equal(split.splitApplied, false);
  assert.equal(split.towardTarget, 10000);
  assert.equal(split.surplus, 0);
});
