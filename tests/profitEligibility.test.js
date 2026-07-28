const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMemberShares,
  memberBalanceWeight,
  getActiveMembersFilter,
  resolveProfitCutoffDate,
} = require('../services/profitService');
const {
  getNextMonthStart,
  money,
} = require('../services/memberMigrationService');

test('getNextMonthStart returns first day of following calendar month', () => {
  const next = getNextMonthStart(new Date(2026, 6, 28)); // Jul 28, 2026
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 7); // August
  assert.equal(next.getDate(), 1);
});

test('resolveProfitCutoffDate uses yearMonth first-of-month', () => {
  const cutoff = resolveProfitCutoffDate({ yearMonth: '2026-08' });
  assert.equal(cutoff.getFullYear(), 2026);
  assert.equal(cutoff.getMonth(), 7);
  assert.equal(cutoff.getDate(), 1);
});

test('getActiveMembersFilter requires active status and gates by profitEligibleFrom', () => {
  const filter = getActiveMembersFilter({ yearMonth: '2026-08' });
  assert.equal(filter.role, 'member');
  assert.equal(filter.status, 'active');
  assert.ok(Array.isArray(filter.$or));
  assert.equal(filter.$or.length, 3);
});

test('getActiveMembersFilter without period has no eligibility gate', () => {
  const filter = getActiveMembersFilter();
  assert.equal(filter.status, 'active');
  assert.equal(filter.$or, undefined);
});

test('memberBalanceWeight uses savings + profit', () => {
  assert.equal(memberBalanceWeight({ savings: 100, profit: 50 }), 150);
  assert.equal(memberBalanceWeight({ savings: 0, profit: 0 }), 0);
});

test('calculateMemberShares balance request is forced equal in equal-share society', () => {
  const members = [
    { _id: '1', name: 'A', savings: 100, profit: 100 }, // would be weight 200 under balance
    { _id: '2', name: 'B', savings: 300, profit: 100 }, // would be weight 400 under balance
  ];
  const shares = calculateMemberShares(members, 90, 'balance');
  assert.equal(shares[0].amount, 45);
  assert.equal(shares[1].amount, 45);
});

test('calculateMemberShares proportional request is forced equal in equal-share society', () => {
  const members = [
    { _id: '1', name: 'A', savings: 100, profit: 0 },
    { _id: '2', name: 'B', savings: 300, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 100, 'proportional');
  assert.equal(shares[0].amount, 50);
  assert.equal(shares[1].amount, 50);
});

test('new member activated mid-month is not eligible until next month cutoff', () => {
  const activatedAt = new Date(2026, 6, 15); // Jul 15
  const eligibleFrom = getNextMonthStart(activatedAt); // Aug 1
  const julyCutoff = resolveProfitCutoffDate({ yearMonth: '2026-07' });
  const augustCutoff = resolveProfitCutoffDate({ yearMonth: '2026-08' });
  assert.ok(eligibleFrom > julyCutoff);
  assert.ok(eligibleFrom <= augustCutoff);
  assert.equal(money(eligibleFrom.getDate()), 1);
});
