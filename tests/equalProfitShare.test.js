const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMemberShares,
  resolveSocietyDistributionType,
  getActiveMembersFilter,
} = require('../services/profitService');
const { isEqualShareSociety, getDistributionType } = require('../services/societyConfig');
const { computeMonthlyDepositSplit } = require('../services/monthlyTargetService');

test('society config enforces equal contribution / equal profit mode', () => {
  assert.equal(isEqualShareSociety(), true);
  assert.equal(getDistributionType(), 'equal');
});

test('resolveSocietyDistributionType never allows balance or proportional overrides in equal society', () => {
  assert.equal(resolveSocietyDistributionType('balance', { force: true }), 'equal');
  assert.equal(resolveSocietyDistributionType('proportional', { force: true }), 'equal');
  assert.equal(resolveSocietyDistributionType('dividend_auto', { force: true }), 'equal');
  assert.equal(resolveSocietyDistributionType(null), 'equal');
});

test('extra deposits cannot buy more profit — unequal savings still get equal shares', () => {
  const members = [
    { _id: '1', name: 'PaidExtra', savings: 50000, profit: 10000 },
    { _id: '2', name: 'Normal', savings: 5000, profit: 0 },
    { _id: '3', name: 'LatePayer', savings: 1000, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 90, 'balance');
  assert.equal(shares.length, 3);
  assert.equal(shares[0].amount, 30);
  assert.equal(shares[1].amount, 30);
  assert.equal(shares[2].amount, 30);
});

test('requesting proportional still yields equal shares under equal society', () => {
  const members = [
    { _id: '1', name: 'A', savings: 100, profit: 0 },
    { _id: '2', name: 'B', savings: 300, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 100, 'proportional');
  assert.equal(shares[0].amount, 50);
  assert.equal(shares[1].amount, 50);
});

test('fixed monthly target: surplus above dues goes to advance, not extra savings share', () => {
  const split = computeMonthlyDepositSplit(10000, 5000, 5000);
  assert.equal(split.towardTarget, 5000);
  assert.equal(split.surplus, 5000);
});

test('profit eligibility filter ignores contribution/borrow status (only active + eligibility date)', () => {
  const filter = getActiveMembersFilter({ yearMonth: '2026-08' });
  assert.equal(filter.status, 'active');
  assert.equal(filter.pendingEntryBuyIn.$ne, true);
  // No unpaid-due / borrow gates — late cover does not remove equal profit.
  assert.equal(filter['contributionStatus'], undefined);
  assert.equal(filter.unpaidAmount, undefined);
});
