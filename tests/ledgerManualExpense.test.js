'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const modelJs = fs.readFileSync(path.join(__dirname, '../models/BankLedgerEntry.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(__dirname, '../services/bankLedgerService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/bankLedger.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const auditJs = fs.readFileSync(path.join(__dirname, '../services/transactionAuditService.js'), 'utf8');

test('ledger entry model includes manual expense debit types', () => {
  ['operational_expense', 'office_cost', 'utility', 'miscellaneous', 'cash_out'].forEach((type) => {
    assert.match(modelJs, new RegExp(`'${type}'`));
  });
  assert.match(modelJs, /MANUAL_EXPENSE_TYPES/);
});

test('bankLedgerService exports recordManualExpense and expense type list', () => {
  const svc = require('../services/bankLedgerService');
  assert.equal(typeof svc.recordManualExpense, 'function');
  assert.equal(typeof svc.listManualExpenseTypes, 'function');
  const types = svc.listManualExpenseTypes();
  assert.ok(types.some((row) => row.key === 'operational_expense'));
  assert.ok(types.some((row) => row.key === 'cash_out'));
});

test('recordManualExpense validates type and builds paid-to note', () => {
  assert.match(serviceJs, /async function recordManualExpense/);
  assert.match(serviceJs, /Paid to:/);
  assert.match(serviceJs, /direction: 'debit'|await debit\(/);
  assert.match(serviceJs, /Insufficient bank ledger balance|nextBalance < -0\.001/);
});

test('bank ledger routes expose expense cash-out endpoint', () => {
  const router = require('../routes/bankLedger');
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(paths.some((p) => p.includes('/expense')));
  assert.ok(paths.some((p) => p.includes('/expense-types')));
  assert.match(routesJs, /recordManualExpense/);
  assert.match(routesJs, /requirePasswordConfirmation/);
});

test('cashier banking ledger has manual expense form fields', () => {
  assert.match(staffHtml, /id="ledgerManualExpenseForm"/);
  assert.match(staffHtml, /Record Manual Expense \/ Cash Out/);
  assert.match(staffHtml, /name="expenseType"/);
  assert.match(staffHtml, /name="recipient"/);
  assert.match(staffHtml, /name="amount"/);
  assert.match(staffHtml, /name="note"/);
  assert.match(staffJs, /\/api\/admin\/bank-ledger\/expense/);
  assert.match(staffJs, /await loadBankLedger\(\)/);
});

test('transaction audit maps expense types to expenses category', () => {
  assert.match(auditJs, /key: 'expenses'/);
  assert.match(auditJs, /operational_expense: 'expenses'/);
  assert.match(auditJs, /cash_out: 'expenses'/);
});
