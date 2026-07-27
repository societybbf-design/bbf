const test = require('node:test');
const assert = require('node:assert/strict');
const { getDuesAlert } = require('../services/memberService');

test('getDuesAlert flags overdue dues after the 10th without a monthly deposit', async () => {
  const result = await getDuesAlert({
    deposits: [{ createdAt: new Date('2026-06-20') }],
  }, new Date('2026-07-12'));

  assert.equal(result.isOverdue, true);
  assert.match(result.message, /overdue/i);
});

test('getDuesAlert stays clear when a deposit exists for the current month', async () => {
  const result = await getDuesAlert({
    deposits: [{ createdAt: new Date('2026-07-05') }],
  }, new Date('2026-07-12'));

  assert.equal(result.isOverdue, false);
  assert.equal(result.message, '');
});
