'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(__dirname, '../services/advanceBorrowingService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/advanceBorrowing.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const pdfJs = fs.readFileSync(path.join(__dirname, '../services/documentPdfService.js'), 'utf8');

test('funding module keeps overview tables and PDF export only', () => {
  assert.match(staffHtml, /id="cashierAdvanceBody"/);
  assert.match(staffHtml, /id="cashierUnpaidBody"/);
  assert.match(staffHtml, /id="cashierFundingPdfBtn"/);
  assert.match(staffHtml, /Download PDF/);
  assert.match(staffHtml, /id="cashierAdvanceForm"/);
  assert.doesNotMatch(staffHtml, /Create internal borrow/);
  assert.doesNotMatch(staffHtml, /Open borrowings — settle repayment/);
  assert.doesNotMatch(staffHtml, /id="cashierBorrowForm"/);
  assert.doesNotMatch(staffHtml, /id="cashierBorrowingsBody"/);
  assert.doesNotMatch(staffHtml, /Settle &amp; refund lender/);
});

test('manual create-borrow and settle handlers are removed from cashier UI', () => {
  assert.doesNotMatch(staffJs, /function bindFundingSettleActions/);
  assert.doesNotMatch(staffJs, /async function settleBorrowingRepayment/);
  assert.doesNotMatch(staffJs, /function populateBorrowLenderSelect/);
  assert.doesNotMatch(staffJs, /cashierBorrowForm/);
  assert.doesNotMatch(staffJs, /data-settle-borrowing/);
  assert.match(staffJs, /async function loadFundingModule/);
  assert.match(staffJs, /data-cover-reserve/);
  assert.match(staffJs, /data-repay-contribution/);
});

test('settlement service still auto-refunds lender advance on repayment', () => {
  assert.match(serviceJs, /Deducts from borrower Savings \+ Advance Balance/);
  assert.match(serviceJs, /deductedFromSavings = money\(Math\.min\(borrowerSavingsBefore, left\)\)/);
  assert.match(serviceJs, /deductedFromAdvance = money\(Math\.min\(borrowerAdvanceBefore, left\)\)/);
  assert.match(serviceJs, /\$inc:\s*\{\s*advanceBalance:\s*payAmount\s*\}/);
  assert.match(serviceJs, /notifyLenderAdvanceRefund/);
  assert.match(serviceJs, /refundedAmount: payAmount/);
});

test('funding routes keep repay API and add PDF export', () => {
  assert.match(routesJs, /router\.post\('\/borrowings\/:id\/repay'/);
  assert.match(routesJs, /settleInternalBorrowing/);
  assert.match(routesJs, /router\.get\('\/report\.pdf'/);
  assert.match(routesJs, /generateAdvancesBorrowingsPdf/);
  assert.match(pdfJs, /async function generateAdvancesBorrowingsPdf/);
});
