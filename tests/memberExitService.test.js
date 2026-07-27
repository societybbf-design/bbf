const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRedistributionPlan, buildApprovalTracking } = require('../services/memberExitService');
const { money } = require('../services/memberMigrationService');

test('buildRedistributionPlan splits proportionally by savings weight', () => {
  const remaining = [
    { _id: 'a', name: 'A', savings: 75 },
    { _id: 'b', name: 'B', savings: 25 },
  ];
  const plan = buildRedistributionPlan(remaining, {
    savings: 100,
    profit: 40,
    advance: 20,
  });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].savingsCredit, 75);
  assert.equal(plan[1].savingsCredit, 25);
  assert.equal(money(plan[0].totalCredit + plan[1].totalCredit), 160);
});

test('buildRedistributionPlan falls back to equal split when savings are zero', () => {
  const remaining = [
    { _id: 'a', name: 'A', savings: 0 },
    { _id: 'b', name: 'B', savings: 0 },
  ];
  const plan = buildRedistributionPlan(remaining, {
    savings: 50,
    profit: 0,
    advance: 0,
  });
  assert.equal(plan[0].savingsCredit, 25);
  assert.equal(plan[1].savingsCredit, 25);
});

test('buildApprovalTracking requires departing + all eligible members', () => {
  const tracking = buildApprovalTracking({
    departingApproval: { approvedAt: new Date() },
    eligibleMembers: ['m1', 'm2'],
    memberApprovals: [{ member: 'm1' }],
  });
  assert.equal(tracking.departingApproved, true);
  assert.equal(tracking.approvedCount, 1);
  assert.equal(tracking.totalMembers, 2);
  assert.equal(tracking.allMembersApproved, false);
});
