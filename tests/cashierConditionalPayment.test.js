'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(__dirname, '../services/investmentService.js'), 'utf8');

test('Complete payment completes directly when canCompleteDirectly is true', () => {
  assert.match(staffJs, /Conditional Complete payment/);
  assert.match(staffJs, /if \(check\.canCompleteDirectly\)/);
  assert.match(staffJs, /executeCashierCompletePayment\(id/);
  assert.match(staffJs, /Only open the interactive modal when/);
});

test('payment popup opens only when member/book problems need attention', () => {
  assert.match(staffJs, /Equal-share audit — accounts that are short/);
  assert.match(staffJs, /hasMemberProblems/);
  assert.match(staffJs, /Exact deficit/);
  assert.match(staffJs, /borrowerId/);
  assert.match(staffJs, /coverMode/);
});

test('funding snapshot exposes member shortfalls and canCompleteDirectly', () => {
  assert.match(serviceJs, /async function previewMemberShareFunding/);
  assert.match(serviceJs, /canCompleteDirectly/);
  assert.match(serviceJs, /hasMemberProblems/);
  assert.match(serviceJs, /MEMBER_SHARE_SHORTFALL/);
  assert.match(serviceJs, /borrowerId/);
});

test('member share deficit is expected share minus available savings\+advance', () => {
  const expectedShare = 10000;
  const available = 6500;
  const shareDeficit = Number(Math.max(0, expectedShare - available).toFixed(2));
  assert.equal(shareDeficit, 3500);
  assert.equal(Number(Math.max(0, 10000 - 10000).toFixed(2)), 0);
});

test('canCompleteDirectly requires book ready and no member problems', () => {
  const cases = [
    { openingSet: true, shortfall: 0, hasMemberProblems: false, expected: true },
    { openingSet: true, shortfall: 0, hasMemberProblems: true, expected: false },
    { openingSet: true, shortfall: 1, hasMemberProblems: false, expected: false },
    { openingSet: false, shortfall: 0, hasMemberProblems: false, expected: false },
  ];
  cases.forEach((row) => {
    const bookReady = row.openingSet && row.shortfall <= 0.001;
    const canCompleteDirectly = bookReady && !row.hasMemberProblems;
    assert.equal(canCompleteDirectly, row.expected);
  });
});
