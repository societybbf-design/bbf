'use strict';

/**
 * Member financial settlement helpers remain for exit/cashier payouts.
 * User Management soft-delete was removed — accounts use inactive/blocked only.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const lifecycleJs = fs.readFileSync(path.join(__dirname, '../services/memberLifecycleService.js'), 'utf8');
const securityJs = fs.readFileSync(path.join(__dirname, '../services/securityService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/developer.js'), 'utf8');
const developerJs = fs.readFileSync(path.join(__dirname, '../public/js/developer.js'), 'utf8');
const umHtml = fs.readFileSync(path.join(__dirname, '../views/user-management.html'), 'utf8');
const userModelJs = fs.readFileSync(path.join(__dirname, '../models/User.js'), 'utf8');

test('deletion settlement preview includes balances and book payable', () => {
  assert.match(lifecycleJs, /async function getMemberDeletionSettlementPreview/);
  assert.match(lifecycleJs, /savings \+ profit \+ advance/);
  assert.match(lifecycleJs, /emergencyReserveShare/);
  assert.match(lifecycleJs, /bookPayable/);
  assert.match(lifecycleJs, /lifetimeDeposits/);
});

test('settlement debits central book and records exit_settlement trail', () => {
  assert.match(lifecycleJs, /async function settleMemberBalancesForDeletion/);
  assert.match(lifecycleJs, /type: 'exit_settlement'/);
  assert.match(lifecycleJs, /type: 'project_payout'/);
  assert.match(lifecycleJs, /debit\(/);
  assert.match(lifecycleJs, /debitReserve/);
  assert.match(lifecycleJs, /exitSettlementSource = 'user_management'/);
  assert.match(lifecycleJs, /member\.savings = 0/);
  assert.match(lifecycleJs, /member\.advanceBalance = 0/);
});

test('user management no longer soft-deletes accounts', () => {
  assert.match(securityJs, /Account deletion is disabled/);
  assert.match(routesJs, /softDeleteEnabled:\s*false/);
  assert.match(routesJs, /status\(410\)/);
  assert.doesNotMatch(developerJs, /openDeletionSettlementModal/);
  assert.doesNotMatch(umHtml, /devDeleteSettleModal/);
});

test('removeMember now deactivates instead of soft-deleting', () => {
  assert.match(lifecycleJs, /member\.status = 'inactive'/);
  assert.match(lifecycleJs, /sessionVersion/);
});

test('user model allows user_management exit settlement source', () => {
  assert.match(userModelJs, /user_management/);
});
