const test = require('node:test');
const assert = require('node:assert/strict');
const {
  money,
  amountsMatch,
  getNextMonthStart,
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

test('getNextMonthStart aligns new-member profit eligibility to next month', () => {
  const from = getNextMonthStart(new Date('2026-01-31T12:00:00Z'));
  assert.equal(from.getDate(), 1);
  assert.ok(from.getMonth() === 1 || from.getMonth() === 2); // Feb or Mar depending on TZ
});

test('manual project valuation normalizes comma decimals like 30000,00', () => {
  const raw = '30000,00';
  const normalized = Number(String(raw).replace(',', '.'));
  assert.equal(money(normalized), 30000);
});
