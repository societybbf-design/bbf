const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOwnership,
  splitByOwnership,
  money,
} = require('../services/projectFinanceService');

test('normalizeOwnership defaults to 100% society', () => {
  const result = normalizeOwnership({ amount: 1000 });
  assert.equal(result.societyOwnershipPct, 100);
  assert.equal(result.investorOwnershipPct, 0);
  assert.equal(result.societyAmount, 1000);
  assert.equal(result.externalAmount, 0);
});

test('normalizeOwnership splits by percentage', () => {
  const result = normalizeOwnership({
    amount: 1000,
    societyOwnershipPct: 60,
    investorOwnershipPct: 40,
  });
  assert.equal(result.societyAmount, 600);
  assert.equal(result.externalAmount, 400);
});

test('normalizeOwnership rejects percentages that do not sum to 100', () => {
  assert.throws(
    () => normalizeOwnership({ amount: 1000, societyOwnershipPct: 70, investorOwnershipPct: 20 }),
    /100%/
  );
});

test('splitByOwnership preserves total across society and investor', () => {
  const split = splitByOwnership(250, 40, 60);
  assert.equal(money(split.societyShare + split.investorShare), 250);
  assert.equal(split.societyShare, 100);
  assert.equal(split.investorShare, 150);
});
