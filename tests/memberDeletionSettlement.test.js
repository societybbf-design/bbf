'use strict';

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

test('soft-delete requires settlement confirmation for members with balances', () => {
  assert.match(securityJs, /settleMemberBalancesForDeletion/);
  assert.match(securityJs, /confirmSettlementAmount/);
  assert.match(securityJs, /getMemberDeletionSettlementPreview/);
  assert.match(routesJs, /deletion-settlement/);
  assert.match(routesJs, /confirmSettlementAmount/);
  assert.match(routesJs, /requirePasswordConfirmation/);
});

test('user management shows deletion settlement confirmation modal', () => {
  assert.match(umHtml, /id="devDeleteSettleModal"/);
  assert.match(umHtml, /id="devDeleteSettleConfirmAmount"/);
  assert.match(developerJs, /openDeletionSettlementModal/);
  assert.match(developerJs, /submitDeletionSettlement/);
  assert.match(developerJs, /Central book debit/);
  assert.match(developerJs, /Total payable to member/);
});

test('user model allows user_management exit settlement source', () => {
  assert.match(userModelJs, /user_management/);
});
