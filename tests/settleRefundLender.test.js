'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(__dirname, '../services/advanceBorrowingService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/advanceBorrowing.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');

test('Settle & refund lender uses delegated click handler to repay API', () => {
  assert.match(staffJs, /function bindFundingSettleActions/);
  assert.match(staffJs, /async function settleBorrowingRepayment/);
  assert.match(staffJs, /data-settle-borrowing/);
  assert.match(staffJs, /\/api\/admin\/funding\/borrowings\/\$\{encodeURIComponent\(id\)\}\/repay/);
  const settleIdx = staffJs.indexOf('async function settleBorrowingRepayment');
  const settleSlice = staffJs.slice(settleIdx, settleIdx + 1800);
  assert.doesNotMatch(settleSlice, /window\.confirm/);
  assert.match(settleSlice, /Settling repayment/);
});

test('settlement deducts borrower savings, credits ledger, refunds lender advance', () => {
  assert.match(serviceJs, /Deducts the repaid amount from the borrower's savings/);
  assert.match(serviceJs, /borrower\.savings = money\(borrowerSavingsBefore - payAmount\)/);
  assert.match(serviceJs, /lender\.advanceBalance = money\(Number\(lender\.advanceBalance \|\| 0\) \+ payAmount\)/);
  assert.match(serviceJs, /creditInbound/);
  assert.match(serviceJs, /deductedAmount: payAmount/);
  assert.match(serviceJs, /refundedAmount: payAmount/);
});

test('funding repay route is wired for settlement', () => {
  assert.match(routesJs, /router\.post\('\/borrowings\/:id\/repay'/);
  assert.match(routesJs, /settleInternalBorrowing/);
});

test('staff funding panel has settle message and open borrowings table', () => {
  assert.match(staffHtml, /id="cashierBorrowingsBody"/);
  assert.match(staffHtml, /id="cashierSettleMessage"/);
  assert.match(staffHtml, /Open borrowings — settle repayment/);
});

test('UI refreshes open borrowings after settlement', () => {
  assert.match(staffJs, /await loadFundingModule\(\)/);
  assert.match(staffJs, /data-borrowing-row/);
  assert.match(staffJs, /row\.remove\(\)/);
});
