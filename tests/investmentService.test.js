const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateInvestmentPerformance,
  deductFromTotalSavings,
} = require('../services/investmentService');

test('calculateInvestmentPerformance returns the net balance and profit for an investment', () => {
  const result = calculateInvestmentPerformance({
    amount: 1000,
    withdrawals: 250,
    profit: 140,
    allocation: 'Equipment Purchase',
  });

  assert.equal(result.allocation, 'Equipment Purchase');
  assert.equal(result.balance, 890);
  assert.equal(result.netProfit, 140);
  assert.equal(result.remainingAfterWithdrawals, 750);
});

test('deductFromTotalSavings rejects amounts above available savings', async () => {
  const User = require('../models/User');
  const originalFind = User.find;

  User.find = async () => ([
    { savings: 100, save: async function save() {} },
    { savings: 100, save: async function save() {} },
  ]);

  try {
    await assert.rejects(
      () => deductFromTotalSavings(500),
      /Insufficient total savings/
    );
  } finally {
    User.find = originalFind;
  }
});
