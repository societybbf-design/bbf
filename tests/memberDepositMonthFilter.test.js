'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMonthlyDepositHistory,
  publicMonthlyHistory,
} = require('../services/memberService');

const memberServiceJs = fs.readFileSync(path.join(__dirname, '../services/memberService.js'), 'utf8');
const memberRoutesJs = fs.readFileSync(path.join(__dirname, '../routes/member.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

test('buildMonthlyDepositHistory marks paid / partial / unpaid from dues', () => {
  const now = new Date(2026, 6, 15); // July 2026
  const duesByMonth = new Map([
    ['2026-07', { status: 'partial', paidAmount: 20000, unpaidAmount: 30000, expectedAmount: 50000, surplusToAdvance: 0 }],
    ['2026-06', { status: 'paid', paidAmount: 50000, unpaidAmount: 0, expectedAmount: 50000, surplusToAdvance: 0 }],
    ['2026-05', { status: 'unpaid', paidAmount: 0, unpaidAmount: 50000, expectedAmount: 50000, surplusToAdvance: 0 }],
  ]);
  const deposits = [
    { amount: 20000, type: 'regular', yearMonth: '2026-07', createdAt: new Date(2026, 6, 10) },
    { amount: 50000, type: 'regular', yearMonth: '2026-06', createdAt: new Date(2026, 5, 8) },
  ];
  const history = buildMonthlyDepositHistory(deposits, now, duesByMonth);
  assert.equal(history.length, 12);
  const july = history.find((row) => row.yearMonth === '2026-07');
  const june = history.find((row) => row.yearMonth === '2026-06');
  const may = history.find((row) => row.yearMonth === '2026-05');
  assert.equal(july.status, 'partial');
  assert.equal(june.status, 'paid');
  assert.equal(may.status, 'unpaid');
  assert.equal(july.unpaidAmount, 30000);
});

test('publicMonthlyHistory strips heavy fields and keeps transaction basics', () => {
  const publicRows = publicMonthlyHistory([{
    label: 'Jul 2026',
    monthLabel: 'July 2026',
    yearMonth: '2026-07',
    status: 'partial',
    amount: 20000,
    regularAmount: 20000,
    advanceAmount: 0,
    expectedAmount: 50000,
    unpaidAmount: 30000,
    deposits: [{
      _id: 'd1',
      amount: 20000,
      type: 'regular',
      receiptNumber: 'DEP-202607-00002',
      notes: 'Smart payment',
      createdAt: new Date('2026-07-10T10:00:00Z'),
      password: 'secret',
    }],
  }]);
  assert.equal(publicRows[0].depositCount, 1);
  assert.equal(publicRows[0].deposits[0].receiptNumber, 'DEP-202607-00002');
  assert.equal(publicRows[0].deposits[0].password, undefined);
});

test('member deposit-history route and interactive UI are wired', () => {
  assert.match(memberRoutesJs, /router\.get\('\/deposit-history'/);
  assert.match(memberRoutesJs, /getMemberDepositHistory/);
  assert.match(memberRoutesJs, /monthlyHistory/);
  assert.match(memberServiceJs, /async function getMemberDepositHistory/);
  assert.match(memberHtml, /id="memberDepositMonthSelect"/);
  assert.match(memberHtml, /id="memberDepositMonthDetail"/);
  assert.match(memberHtml, /id="memberDepositMonthChips"/);
  assert.match(memberJs, /\/api\/member\/deposit-history/);
  assert.match(memberJs, /function selectMemberDepositMonth/);
  assert.match(memberJs, /function renderDepositMonthDetail/);
  assert.match(memberJs, /Partially paid/);
  assert.match(memberJs, /Paid in full/);
  assert.match(stylesCss, /\.member-deposit-month-chip/);
});
