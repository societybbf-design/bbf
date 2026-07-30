'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateManualDepositInput,
  MAX_MANUAL_DEPOSIT_AMOUNT,
} = require('../services/depositValidation');
const {
  normalizeIdempotencyKey,
} = require('../services/depositIdempotencyService');

const root = path.join(__dirname, '..');
const adminDeposits = fs.readFileSync(path.join(root, 'routes/adminDeposits.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const ledgerJs = fs.readFileSync(path.join(root, 'services/bankLedgerService.js'), 'utf8');
const smartJs = fs.readFileSync(path.join(root, 'services/smartRepaymentService.js'), 'utf8');
const memberService = fs.readFileSync(path.join(root, 'services/memberService.js'), 'utf8');
const receiptJs = fs.readFileSync(path.join(root, 'services/receiptService.js'), 'utf8');

test('validateManualDepositInput accepts clean cash deposits', () => {
  const result = validateManualDepositInput({
    memberId: '507f1f77bcf86cd799439011',
    amount: '1250.50',
    paymentMethod: 'cash',
  });
  assert.equal(result.amount, 1250.5);
  assert.equal(result.paymentMethod, 'cash');
  assert.equal(result.paymentReference, '');
});

test('validateManualDepositInput requires bank/mfs reference and rejects bad amounts', () => {
  assert.throws(
    () => validateManualDepositInput({
      memberId: '507f1f77bcf86cd799439011',
      amount: 100,
      paymentMethod: 'bank',
      paymentReference: '',
    }),
    /Payment reference/
  );
  assert.throws(
    () => validateManualDepositInput({
      memberId: 'bad',
      amount: 10,
      paymentMethod: 'cash',
    }),
    /valid member/
  );
  assert.throws(
    () => validateManualDepositInput({
      memberId: '507f1f77bcf86cd799439011',
      amount: 10.123,
      paymentMethod: 'cash',
    }),
    /2 decimal/
  );
  assert.throws(
    () => validateManualDepositInput({
      memberId: '507f1f77bcf86cd799439011',
      amount: MAX_MANUAL_DEPOSIT_AMOUNT + 1,
      paymentMethod: 'cash',
    }),
    /maximum/
  );
});

test('idempotency key normalization rejects empty or illegal keys', () => {
  assert.throws(() => normalizeIdempotencyKey('short'), /8 and 128/);
  assert.throws(() => normalizeIdempotencyKey('has spaces!!'), /invalid/);
  assert.equal(normalizeIdempotencyKey('deposit-abc-12345'), 'deposit-abc-12345');
});

test('deposit routes require idempotency and shared validation', () => {
  assert.match(adminDeposits, /beginDepositIdempotency/);
  assert.match(adminDeposits, /validateManualDepositInput/);
  assert.match(adminDeposits, /Idempotency-Key|clientRequestId|resolveDepositIdempotencyKey/);
  assert.match(adminDeposits, /idempotentReplay/);
});

test('bank ledger posts use atomic bookBalance increments', () => {
  assert.match(ledgerJs, /\$inc:\s*\{\s*bookBalance:/);
  assert.match(ledgerJs, /bookBalance:\s*\{\s*\$gte:/);
});

test('smart payment and saveDeposit no longer soft-skip ledger credits', () => {
  assert.doesNotMatch(smartJs, /tryCredit\(/);
  assert.match(smartJs, /withMongoTransaction\(async \(session\) =>/);
  assert.match(smartJs, /creditInbound\(\{[\s\S]*session,/);
  assert.match(memberService, /Do not resubmit; reconcile the ledger/);
});

test('receipt numbers use an atomic counter', () => {
  assert.match(receiptJs, /models\/Counter/);
  assert.match(receiptJs, /\$inc:\s*\{\s*seq:\s*1\s*\}/);
});

test('cashier deposit UI has confirm, submit lock, and idempotency key', () => {
  assert.match(staffHtml, /Required for bank \/ MFS/);
  assert.match(staffHtml, /id="cashierDepositSubmitBtn"/);
  assert.match(staffJs, /Idempotency-Key/);
  assert.match(staffJs, /clientRequestId/);
  assert.match(staffJs, /Confirm deposit for/);
  assert.match(staffJs, /submitBtn\.disabled = true/);
  assert.match(staffJs, /Payment reference \/ txn ID is required/);
});
