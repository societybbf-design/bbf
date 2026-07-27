const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeTransactions,
  CATEGORY_LABELS,
} = require('../services/transactionAuditService');

describe('transactionAuditService', () => {
  it('summarizes in/out totals and categories', () => {
    const summary = summarizeTransactions([
      {
        category: 'deposits',
        categoryLabel: CATEGORY_LABELS.deposits,
        direction: 'in',
        amount: 100,
      },
      {
        category: 'withdrawals',
        categoryLabel: CATEGORY_LABELS.withdrawals,
        direction: 'out',
        amount: 25,
      },
      {
        category: 'deposits',
        categoryLabel: CATEGORY_LABELS.deposits,
        direction: 'in',
        amount: 50,
      },
    ]);

    assert.equal(summary.totalIn, 150);
    assert.equal(summary.totalOut, 25);
    assert.equal(summary.net, 125);
    assert.equal(summary.count, 3);
    assert.equal(summary.byCategory.length, 2);
  });
});
