'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  withMongoTransaction,
  bindSession,
  sessionOpt,
  createWithSession,
} = require('../services/mongoTransaction');

const root = path.join(__dirname, '..');
const smartJs = fs.readFileSync(path.join(root, 'services/smartRepaymentService.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(root, 'services/memberService.js'), 'utf8');
const advanceJs = fs.readFileSync(path.join(root, 'services/advanceBorrowingService.js'), 'utf8');
const ledgerJs = fs.readFileSync(path.join(root, 'services/bankLedgerService.js'), 'utf8');
const monthlyJs = fs.readFileSync(path.join(root, 'services/monthlyTargetService.js'), 'utf8');
const receiptJs = fs.readFileSync(path.join(root, 'services/receiptService.js'), 'utf8');

test('mongoTransaction helpers expose session utilities', () => {
  assert.equal(typeof withMongoTransaction, 'function');
  assert.equal(typeof bindSession, 'function');
  assert.equal(typeof sessionOpt, 'function');
  assert.equal(typeof createWithSession, 'function');
  assert.deepEqual(sessionOpt(null, { new: true }), { new: true });
  assert.deepEqual(sessionOpt({ id: 1 }, { new: true }), { new: true, session: { id: 1 } });
});

test('applySmartMemberPayment wraps legs and ledger in withMongoTransaction', () => {
  assert.match(smartJs, /withMongoTransaction\(async \(session\) =>/);
  assert.match(smartJs, /skipNotifications:\s*true/);
  assert.match(smartJs, /session,/);
  assert.match(smartJs, /creditInbound\(\{[\s\S]*session,/);
  assert.match(smartJs, /transactional:\s*true/);
  assert.match(smartJs, /All deposit \/ repay \/ settle \/ ledger writes run inside withMongoTransaction/);
});

test('saveDeposit / monthly due / receipts accept session', () => {
  assert.match(memberJs, /options\.session/);
  assert.match(memberJs, /createDepositWithReceipt\(Deposit/);
  assert.match(memberJs, /sessionOpt\(session,\s*\{\s*new:\s*true\s*\}\)/);
  assert.match(monthlyJs, /async function applyDepositToMonthlyDue\([\s\S]*session = null/);
  assert.match(monthlyJs, /getOrCreateMemberDue\([\s\S]*\{\s*session\s*\}/);
  assert.match(receiptJs, /async function generateReceiptNumber\(prefix = 'DEP'/);
  assert.match(receiptJs, /async function createDepositWithReceipt/);
  assert.match(receiptJs, /\$inc:\s*\{\s*seq:\s*1\s*\}/);
  assert.match(receiptJs, /seq:\s*\{\s*\$lt:\s*floor\s*\}/);
});

test('settle / repay / advance deposit pass session into writes', () => {
  assert.match(advanceJs, /async function settleInternalBorrowing\([\s\S]*session = null/);
  assert.match(advanceJs, /async function repayUnpaidContribution\([\s\S]*session = null/);
  assert.match(advanceJs, /async function saveAdvanceDeposit\([\s\S]*options\.session/);
  assert.match(advanceJs, /createWithSession\(Deposit/);
  assert.match(advanceJs, /skipNotifications/);
  assert.match(advanceJs, /notifyLender:\s*Boolean\(skipNotifications \|\| session\)/);
});

test('bank ledger postEntry threads session through ensure/update/create', () => {
  assert.match(ledgerJs, /async function ensureLedger\(session = null\)/);
  assert.match(ledgerJs, /async function ensureOpeningForInboundCash\([\s\S]*session = null/);
  assert.match(ledgerJs, /session = null,/);
  assert.match(ledgerJs, /sessionOpt\(session,\s*\{\s*new:\s*true\s*\}\)/);
  assert.match(ledgerJs, /createWithSession\(BankLedgerEntry/);
});

test('related deposit security tests still describe hard ledger failures', () => {
  const hardening = fs.readFileSync(path.join(root, 'tests/depositSecurityHardening.test.js'), 'utf8');
  assert.match(hardening, /smart payment and saveDeposit no longer soft-skip ledger credits/);
});
