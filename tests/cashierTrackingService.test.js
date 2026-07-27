const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeAuditTransaction,
  sanitizeLedgerEntry,
  PUBLIC_CATEGORIES,
} = require('../services/cashierTrackingService');

describe('cashierTrackingService', () => {
  it('sanitizes withdrawal transactions without member identity', () => {
    const result = sanitizeAuditTransaction({
      id: 'w1',
      source: 'withdrawal',
      category: 'withdrawals',
      categoryLabel: 'Withdrawals',
      type: 'withdrawal',
      direction: 'out',
      amount: 120,
      balanceAfter: null,
      description: 'Withdrawal processed for Jane Doe',
      actor: 'Cashier',
      partyName: 'Jane Doe',
      partyEmail: 'jane@example.com',
      occurredAt: new Date('2026-01-15'),
    });

    assert.equal(result.description, 'Member withdrawal processed');
    assert.equal(result.actor, undefined);
    assert.equal(result.partyName, undefined);
  });

  it('maps ledger entries to public labels', () => {
    const result = sanitizeLedgerEntry({
      _id: 'abc123',
      type: 'project_payout',
      direction: 'debit',
      amount: 500,
      balanceAfter: 2500,
      note: '',
      createdAt: new Date('2026-02-01'),
    });

    assert.equal(result.typeLabel, 'Project payout');
    assert.equal(result.amount, 500);
    assert.equal(result.balanceAfter, 2500);
  });

  it('excludes adjustments from public categories', () => {
    assert.equal(PUBLIC_CATEGORIES.some((item) => item.key === 'adjustments'), false);
  });
});
