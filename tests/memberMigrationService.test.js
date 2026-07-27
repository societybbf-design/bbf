const test = require('node:test');
const assert = require('node:assert/strict');
const {
  money,
  amountsMatch,
} = require('../services/memberMigrationService');

test('money rounds to two decimal places', () => {
  assert.equal(money(10.556), 10.56);
  assert.equal(money('12.3'), 12.3);
  assert.equal(money(undefined), 0);
});

test('amountsMatch accepts near-equal settlement confirmations', () => {
  assert.equal(amountsMatch(100.00, 100.01), true);
  assert.equal(amountsMatch(100.00, 100.02), false);
});

test('society-fund exit settlement equals savings + profit + advance', () => {
  const savings = 5000;
  const profit = 250.5;
  const advance = 100;
  const settlement = money(savings + profit + advance);
  assert.equal(settlement, 5350.5);
  assert.equal(amountsMatch(settlement, '5350.50'), true);
});
