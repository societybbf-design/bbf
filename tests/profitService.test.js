const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMemberShares } = require('../services/profitService');

test('calculateMemberShares splits profit equally among members', () => {
  const members = [
    { _id: '1', name: 'A', savings: 100, profit: 0 },
    { _id: '2', name: 'B', savings: 200, profit: 0 },
  ];

  const shares = calculateMemberShares(members, 100, 'equal');
  assert.equal(shares.length, 2);
  assert.equal(shares[0].amount, 50);
  assert.equal(shares[1].amount, 50);
});

test('calculateMemberShares splits profit proportionally by savings', () => {
  const members = [
    { _id: '1', name: 'A', savings: 100, profit: 0 },
    { _id: '2', name: 'B', savings: 300, profit: 0 },
  ];

  const shares = calculateMemberShares(members, 100, 'proportional');
  assert.equal(shares[0].amount, 25);
  assert.equal(shares[1].amount, 75);
});

test('calculateMemberShares falls back to equal split when savings are zero', () => {
  const members = [
    { _id: '1', name: 'A', savings: 0, profit: 0 },
    { _id: '2', name: 'B', savings: 0, profit: 0 },
  ];

  const shares = calculateMemberShares(members, 60, 'proportional');
  assert.equal(shares[0].amount, 30);
  assert.equal(shares[1].amount, 30);
});
