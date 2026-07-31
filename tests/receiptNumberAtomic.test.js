'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseReceiptSequence,
  formatReceiptNumber,
  receiptYearMonth,
  isDuplicateKeyError,
  isReceiptDuplicateError,
} = require('../services/receiptService');

const receiptJs = fs.readFileSync(path.join(__dirname, '../services/receiptService.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../services/memberService.js'), 'utf8');
const adminDepositsJs = fs.readFileSync(path.join(__dirname, '../routes/adminDeposits.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('receiptYearMonth and format/parse helpers stay zero-padded', () => {
  assert.equal(receiptYearMonth(new Date(2026, 6, 15)), '202607');
  assert.equal(formatReceiptNumber('DEP', '202607', 1), 'DEP-202607-00001');
  assert.equal(formatReceiptNumber('DEP', '202607', 12), 'DEP-202607-00012');
  assert.equal(parseReceiptSequence('DEP-202607-00001', 'DEP', '202607'), 1);
  assert.equal(parseReceiptSequence('DEP-202607-00042', 'DEP', '202607'), 42);
  assert.equal(parseReceiptSequence('DEP-202606-00099', 'DEP', '202607'), 0);
  assert.equal(parseReceiptSequence('', 'DEP', '202607'), 0);
});

test('duplicate key helpers detect receiptNumber collisions', () => {
  assert.equal(isDuplicateKeyError({ code: 11000, message: 'E11000 duplicate key' }), true);
  assert.equal(isReceiptDuplicateError({
    code: 11000,
    message: 'E11000 duplicate key error collection: society-management.deposits index: receiptNumber_1 dup key: { receiptNumber: "DEP-202607-00001" }',
  }), true);
  assert.equal(isReceiptDuplicateError({
    code: 11000,
    keyPattern: { email: 1 },
    message: 'E11000 duplicate key',
  }), false);
  assert.equal(isDuplicateKeyError({ message: 'validation failed' }), false);
});

test('generateReceiptNumber seeds counter from max existing then $incs atomically', () => {
  assert.match(receiptJs, /async function getLatestReceiptSequence/);
  assert.match(receiptJs, /\$setOnInsert:\s*\{\s*key:\s*counterKey,\s*seq:\s*floor\s*\}/);
  assert.match(receiptJs, /seq:\s*\{\s*\$lt:\s*floor\s*\}/);
  assert.match(receiptJs, /\{\s*\$set:\s*\{\s*seq:\s*floor\s*\}\s*\}/);
  assert.match(receiptJs, /\{\s*\$inc:\s*\{\s*seq:\s*1\s*\}\s*\}/);
  assert.match(receiptJs, /async function createDepositWithReceipt/);
  assert.doesNotMatch(receiptJs, /catch\s*\(_\)\s*\{[\s\S]*findOne\(\{\s*receiptNumber:\s*pattern/);
});

test('saveDeposit creates deposits through createDepositWithReceipt retries', () => {
  assert.match(memberJs, /createDepositWithReceipt\(Deposit/);
  assert.doesNotMatch(memberJs, /generateReceiptNumber\('DEP'/);
});

test('deposit routes map receipt duplicates to clear 409 feedback', () => {
  assert.match(adminDepositsJs, /function depositWriteErrorPayload/);
  assert.match(adminDepositsJs, /RECEIPT_DUPLICATE/);
  assert.match(adminDepositsJs, /isReceiptDuplicateError/);
});

test('cashier deposit form keeps workflow and softens duplicate receipt errors', () => {
  assert.match(staffJs, /RECEIPT_DUPLICATE/);
  assert.match(staffJs, /Receipt number conflict while recording/);
  assert.match(staffJs, /delete form\.dataset\.idempotencyKey/);
  assert.match(staffJs, /Keep member\/amount selection so the cashier can retry/);
  assert.match(staffJs, /await response\.json\(\);\s*\} catch/);
});
