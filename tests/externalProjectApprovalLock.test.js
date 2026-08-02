'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const investmentModel = fs.readFileSync(path.join(root, 'models/Investment.js'), 'utf8');
const walletModel = fs.readFileSync(path.join(root, 'models/ExternalInvestorWallet.js'), 'utf8');
const walletService = fs.readFileSync(path.join(root, 'services/externalInvestorWalletService.js'), 'utf8');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const investmentRoutes = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const externalRoutes = fs.readFileSync(path.join(root, 'routes/externalInvestor.js'), 'utf8');
const portalService = fs.readFileSync(path.join(root, 'services/externalInvestorPortalService.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const approvalsInbox = fs.readFileSync(path.join(root, 'services/approvalsInboxService.js'), 'utf8');

test('Investment status machine includes external approval and CEO fund release', () => {
  assert.match(investmentModel, /pending_external_approval/);
  assert.match(investmentModel, /pending_ceo_fund_release/);
  assert.match(investmentModel, /capitalLocked/);
  assert.match(investmentModel, /approvalStatus/);
  assert.match(investmentModel, /externalFundsReleasedAt/);
});

test('External investor wallet tracks available, reserved, and locked balances', () => {
  assert.match(walletModel, /availableBalance/);
  assert.match(walletModel, /reservedBalance/);
  assert.match(walletModel, /lockedBalance/);
  assert.match(walletService, /assertInvestorsCanCoverStakes/);
  assert.match(walletService, /reserveForProject/);
  assert.match(walletService, /lockReservedForProject/);
  assert.match(walletService, /creditWalletDeposit/);
});

test('createSocietyInvestment checks balance, reserves, and routes to external approval', () => {
  assert.match(investmentService, /assertInvestorsCanCoverStakes/);
  assert.match(investmentService, /pending_external_approval/);
  assert.match(investmentService, /reserveForProject/);
  assert.match(investmentService, /decideExternalProjectCommitment/);
  assert.match(investmentService, /ceoConfirmExternalFundRelease/);
  assert.match(investmentService, /pending_ceo_fund_release/);
  assert.match(investmentService, /lockReservedForProject/);
  assert.match(investmentService, /External Investor capital must be approved and locked/);
});

test('API routes expose wallet deposit, project decide, and fund release', () => {
  assert.match(investmentRoutes, /creditWalletDeposit/);
  assert.match(investmentRoutes, /external-fund-release/);
  assert.match(investmentRoutes, /ceoConfirmExternalFundRelease/);
  assert.match(externalRoutes, /projects\/:id\/decide/);
  assert.match(externalRoutes, /decideExternalProjectCommitment/);
  assert.match(externalRoutes, /\/wallet/);
});

test('Portal and CEO UI surface project commitment approval and fund lock', () => {
  assert.match(portalService, /projectApprovals/);
  assert.match(portalService, /walletAvailable/);
  assert.match(staffJs, /data-external-project-approve/);
  assert.match(staffJs, /decideExternalProject/);
  assert.match(adminJs, /Wallet \(unallocated/);
  assert.match(adminJs, /data-confirm-external-fund-release/);
  assert.match(adminJs, /external-fund-release/);
  assert.match(approvalsInbox, /investment_external_fund_release/);
  assert.match(approvalsInbox, /Confirm & lock funds/);
});

test('wallet reserve rejects insufficient available balance', async () => {
  const {
    assertInvestorsCanCoverStakes,
    money,
  } = require('../services/externalInvestorWalletService');
  const ExternalInvestorWallet = require('../models/ExternalInvestorWallet');
  const originalFindOne = ExternalInvestorWallet.findOne;
  ExternalInvestorWallet.findOne = async () => ({
    investor: 'ext1',
    investorName: 'Ext',
    availableBalance: 100,
    reservedBalance: 0,
    lockedBalance: 0,
    totalDeposited: 100,
    async save() { return this; },
  });
  try {
    await assert.rejects(
      () => assertInvestorsCanCoverStakes([{ investor: 'ext1', amount: 500 }]),
      (err) => err.status === 409 && /insufficient/i.test(err.message)
    );
    assert.equal(money(12.345), 12.35);
  } finally {
    ExternalInvestorWallet.findOne = originalFindOne;
  }
});
