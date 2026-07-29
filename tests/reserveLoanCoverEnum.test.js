'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const modelJs = fs.readFileSync(path.join(__dirname, '../models/EmergencyReserveFund.js'), 'utf8');
const loanServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');

test('EmergencyReserveFund entry type enum allows loan_cover', () => {
  assert.match(modelJs, /'loan_cover'/);
  assert.match(modelJs, /'loan_disbursement'/);
  assert.match(modelJs, /'project_cover'/);
  assert.match(modelJs, /'replenish'/);
});

test('loan shortfall reserve cover uses loan_cover entry type', () => {
  const coverIdx = loanServiceJs.indexOf('async function coverLoanDisbursementFromReserve');
  assert.ok(coverIdx >= 0);
  const slice = loanServiceJs.slice(coverIdx, coverIdx + 2500);
  assert.match(slice, /type:\s*'loan_cover'/);
  assert.match(slice, /debitReserve/);
});
