const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWithdrawalAvailability } = require('../services/withdrawalService');

test('calculateWithdrawalAvailability returns the amount available for a new withdrawal request', () => {
  const result = calculateWithdrawalAvailability({
    savings: 2500,
    pendingAmount: 400,
    requestedAmount: 900,
  });

  assert.equal(result.availableAmount, 2100);
  assert.equal(result.canRequest, true);
  assert.equal(result.remainingAfterRequest, 1200);
});

test('calculateWithdrawalAvailability blocks requests above the remaining balance', () => {
  const result = calculateWithdrawalAvailability({
    savings: 500,
    pendingAmount: 300,
    requestedAmount: 400,
  });

  assert.equal(result.availableAmount, 200);
  assert.equal(result.canRequest, false);
  assert.equal(result.remainingAfterRequest, -200);
});
