'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  money,
  contributionRemainingDue,
  contributionIsBorrowable,
} = require('../services/advanceBorrowingService');

test('contributionRemainingDue uses unpaidAmount when present (including zero)', () => {
  assert.equal(contributionRemainingDue({ unpaidAmount: 0, expectedAmount: 100 }), 0);
  assert.equal(contributionRemainingDue({ unpaidAmount: 25.5, expectedAmount: 100 }), 25.5);
});

test('contributionRemainingDue falls back to expected minus prior payments', () => {
  assert.equal(contributionRemainingDue({
    expectedAmount: 100,
    paidFromSavings: 40,
    paidFromProfit: 15,
    paidFromAdvance: 10,
    borrowedAmount: 20,
  }), 15);
});

test('contributionIsBorrowable allows partial/past payment shares with remaining due', () => {
  assert.equal(contributionIsBorrowable({
    status: 'unpaid',
    unpaidAmount: 15,
    paidFromSavings: 50,
    expectedAmount: 65,
  }), true);

  assert.equal(contributionIsBorrowable({
    status: 'covered_by_borrow',
    unpaidAmount: 5,
    borrowedAmount: 20,
  }), true);

  assert.equal(contributionIsBorrowable({
    status: 'settled',
    unpaidAmount: 0,
  }), false);

  assert.equal(contributionIsBorrowable({
    status: 'paid',
    unpaidAmount: 0,
    expectedAmount: 100,
    paidFromSavings: 100,
  }), false);
});

test('money rounds to two decimals', () => {
  assert.equal(money(10.456), 10.46);
  assert.equal(money(null), 0);
});
