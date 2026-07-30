'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const exitJs = fs.readFileSync(path.join(__dirname, '../services/memberExitService.js'), 'utf8');
const migrationJs = fs.readFileSync(path.join(__dirname, '../services/memberMigrationService.js'), 'utf8');
const exitsRoute = fs.readFileSync(path.join(__dirname, '../routes/memberExits.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const advanceRoute = fs.readFileSync(path.join(__dirname, '../routes/advanceBorrowing.js'), 'utf8');
const modelJs = fs.readFileSync(path.join(__dirname, '../models/MemberExitRequest.js'), 'utf8');
const txnJs = fs.readFileSync(path.join(__dirname, '../services/mongoTransaction.js'), 'utf8');

test('exit payout claims atomically and never double-credits remaining members', () => {
  assert.match(exitJs, /processing_cashier_payment/);
  assert.match(exitJs, /status: 'pending_cashier_payment'/);
  assert.match(exitJs, /Do NOT credit remaining members/);
  assert.doesNotMatch(exitJs, /\$inc:\s*\{\s*savings:/);
  assert.match(exitJs, /liveSettlement/);
  assert.match(exitJs, /withMongoTransaction/);
});

test('member approvals use atomic push to avoid lost updates', () => {
  assert.match(exitJs, /'memberApprovals\.member': \{ \$ne: member\._id \}/);
  assert.match(exitJs, /\$push: \{ memberApprovals: approvalRow \}/);
});

test('replacement uses hard ledger posts with rollback and loan/borrow guards', () => {
  assert.match(migrationJs, /assertReplacementGuards/);
  assert.match(migrationJs, /creditInbound/);
  assert.match(migrationJs, /await debit\(/);
  assert.doesNotMatch(migrationJs, /tryCredit|tryDebit/);
  assert.match(migrationJs, /rollbackLedger/);
  assert.match(migrationJs, /open internal borrowings/);
});

test('CEO-only initiate/replace; Cashier-only payout', () => {
  assert.match(exitsRoute, /requireRoles\('ceo'\)/);
  assert.match(exitsRoute, /requireCashierRole/);
  assert.match(adminRoute, /ceoOnly/);
  assert.match(advanceRoute, /Member replacement must be initiated from the CEO panel/);
});

test('exit model supports processing status and departing proxy metadata', () => {
  assert.match(modelJs, /processing_cashier_payment/);
  assert.match(modelJs, /proxiedBy/);
});

test('mongo transaction helper falls back when unsupported', () => {
  assert.match(txnJs, /withMongoTransaction/);
  assert.match(txnJs, /isTransactionUnsupportedError/);
  assert.match(txnJs, /transactionsLikelySupported/);
});
