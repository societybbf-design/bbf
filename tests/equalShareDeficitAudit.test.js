'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitAmountEqually,
  calculateEqualShareMemberAudit,
} = require('../services/investmentService');

test('splitAmountEqually divides 50000 across 5 members into 10000 each', () => {
  const shares = splitAmountEqually(50000, 5);
  assert.deepEqual(shares, [10000, 10000, 10000, 10000, 10000]);
  assert.equal(Number(shares.reduce((a, b) => a + b, 0).toFixed(2)), 50000);
});

test('splitAmountEqually keeps remainder on the last member', () => {
  const shares = splitAmountEqually(100, 3);
  assert.deepEqual(shares, [33.33, 33.33, 33.34]);
  assert.equal(Number(shares.reduce((a, b) => a + b, 0).toFixed(2)), 100);
});

test('equal-share audit: one member short by exactly 5000 on a 50000/5 project', () => {
  const audit = calculateEqualShareMemberAudit(50000, [
    { id: '1', name: 'A', savings: 10000, advanceBalance: 0 },
    { id: '2', name: 'B', savings: 10000, advanceBalance: 0 },
    { id: '3', name: 'C', savings: 10000, advanceBalance: 0 },
    { id: '4', name: 'D', savings: 10000, advanceBalance: 0 },
    { id: '5', name: 'E', savings: 5000, advanceBalance: 0 },
  ]);

  assert.equal(audit.equalShareBase, 10000);
  assert.equal(audit.memberCount, 5);
  assert.equal(audit.hasMemberShortfall, true);
  assert.equal(audit.shortMembers.length, 1);
  assert.equal(audit.shortMembers[0].name, 'E');
  assert.equal(audit.shortMembers[0].expectedShare, 10000);
  assert.equal(audit.shortMembers[0].available, 5000);
  assert.equal(audit.shortMembers[0].shareDeficit, 5000);
  assert.equal(audit.totalShareDeficit, 5000);
  // Four funded members contribute 40,000 combined availability toward equal shares.
  assert.equal(
    audit.members.slice(0, 4).reduce((sum, row) => sum + row.available, 0),
    40000
  );
});

test('equal-share audit: all members funded → no deficit, direct complete allowed', () => {
  const audit = calculateEqualShareMemberAudit(50000, [
    { id: '1', name: 'A', savings: 8000, advanceBalance: 2000 },
    { id: '2', name: 'B', savings: 10000, advanceBalance: 0 },
    { id: '3', name: 'C', savings: 5000, advanceBalance: 5000 },
    { id: '4', name: 'D', savings: 12000, advanceBalance: 0 },
    { id: '5', name: 'E', savings: 9000, advanceBalance: 1000 },
  ]);

  assert.equal(audit.hasMemberShortfall, false);
  assert.equal(audit.shortMembers.length, 0);
  assert.equal(audit.totalShareDeficit, 0);
  audit.members.forEach((row) => {
    assert.equal(row.shareDeficit, 0);
    assert.equal(row.isShort, false);
  });
});

test('equal-share audit counts savings + advance as available for the share', () => {
  const audit = calculateEqualShareMemberAudit(20000, [
    { id: '1', name: 'A', savings: 5000, advanceBalance: 5000 },
    { id: '2', name: 'B', savings: 3000, advanceBalance: 2000 },
  ]);
  assert.equal(audit.equalShareBase, 10000);
  assert.equal(audit.members[0].shareDeficit, 0);
  assert.equal(audit.members[1].available, 5000);
  assert.equal(audit.members[1].shareDeficit, 5000);
});
