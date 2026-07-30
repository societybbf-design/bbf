'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  money,
  splitByOwnership,
  computeProjectLiquidationSettlement,
} = require('../services/projectFinanceService');
const {
  computeNetProfitLoss,
  outcomeFromNet,
} = require('../services/saleService');

const root = path.join(__dirname, '..');
const financeService = fs.readFileSync(path.join(root, 'services/projectFinanceService.js'), 'utf8');
const saleService = fs.readFileSync(path.join(root, 'services/saleService.js'), 'utf8');
const investmentRoutes = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const salesRoutes = fs.readFileSync(path.join(root, 'routes/sales.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('computeProjectLiquidationSettlement preserves cash identity on profit', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 1000,
    saleAmount: 1600,
    additionalCosts: 50,
    tax: 50,
    societyOwnershipPct: 60,
    investorOwnershipPct: 40,
  });
  assert.equal(plan.netProceeds, 1500);
  assert.equal(plan.netProfit, 500);
  assert.equal(plan.outcomeType, 'profit');
  assert.equal(plan.societySavingsRefund, 600);
  assert.equal(plan.societyProfitShare, 300);
  assert.equal(plan.investorSaleSettlement, 600);
  assert.equal(
    money(plan.societySavingsRefund + plan.investorSaleSettlement + plan.societyProfitShare),
    plan.netProceeds
  );
});

test('computeProjectLiquidationSettlement preserves cash identity on loss', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 1000,
    saleAmount: 800,
    societyOwnershipPct: 60,
    investorOwnershipPct: 40,
  });
  assert.equal(plan.outcomeType, 'loss');
  assert.equal(plan.netProceeds, 800);
  assert.equal(plan.lossSplit.societyShare, 120);
  assert.equal(plan.societySavingsRefund, 480);
  assert.equal(plan.investorSaleSettlement, 320);
  assert.equal(
    money(plan.societySavingsRefund + plan.investorSaleSettlement + plan.societyProfitShare),
    plan.netProceeds
  );
  // Must not refund full society capital on a loss (would over-allocate vs proceeds).
  assert.ok(plan.societySavingsRefund < plan.capitalSplit.societyShare);
});

test('computeProjectLiquidationSettlement handles break-even and accrued investor profit', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 500,
    saleAmount: 500,
    societyOwnershipPct: 100,
    investorOwnershipPct: 0,
    accruedInvestorProfit: 25.555,
  });
  assert.equal(plan.outcomeType, 'break_even');
  assert.equal(plan.societySavingsRefund, 500);
  assert.equal(plan.investorPayout, money(25.555));
  assert.equal(plan.netProfit, 0);
});

test('computeProjectLiquidationSettlement stays precise for odd ownership splits', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 100,
    saleAmount: 133.33,
    societyOwnershipPct: 33,
    investorOwnershipPct: 67,
  });
  const allocated = money(
    plan.societySavingsRefund + plan.investorSaleSettlement + plan.societyProfitShare
  );
  assert.equal(allocated, plan.netProceeds);
  const split = splitByOwnership(plan.netProfit, 33, 67);
  assert.equal(money(split.societyShare + split.investorShare), plan.netProfit);
});

test('saleService net math matches liquidation proceeds formula', () => {
  const net = computeNetProfitLoss({
    saleAmount: 1200.005,
    totalInvestment: 1000,
    additionalCosts: 10.004,
    tax: 5.001,
  });
  // money(1200.01) - money(1000) - money(10) - money(5) = 185.01
  assert.equal(net, 185.01);
  assert.equal(outcomeFromNet(net), 'profit');
  assert.equal(outcomeFromNet(-0.02), 'loss');
  assert.equal(outcomeFromNet(0), 'break_even');
});

test('liquidateProject is transactional with hard ledger ops and Sale creation', () => {
  assert.match(financeService, /async function liquidateProject/);
  assert.match(financeService, /withMongoTransaction\(async \(session\) =>/);
  assert.match(financeService, /createWithSession\(Sale/);
  assert.match(financeService, /creditInbound\(\{[\s\S]*session,/);
  assert.match(financeService, /debit\(\{[\s\S]*investor_payout[\s\S]*session,/);
  assert.match(financeService, /applyLossToMembers/);
  assert.match(financeService, /ledgerLockedAt: lockAt/);
  assert.doesNotMatch(financeService, /tryDebit/);
});

test('createSale delegates to liquidateProject for one settlement path', () => {
  assert.match(saleService, /liquidateProject/);
  assert.match(saleService, /activeTotalInvestment/);
  assert.match(saleService, /canSell/);
});

test('liquidate and sales write routes require profit permission and idempotency', () => {
  assert.match(
    investmentRoutes,
    /router\.post\('\/:id\/liquidate', requirePermission\('can_manage_profit'\), requirePasswordConfirmation/
  );
  assert.match(investmentRoutes, /beginProfitCloseIdempotency/);
  assert.match(salesRoutes, /const writeSales = requirePermission\('can_manage_profit'\)/);
  assert.match(salesRoutes, /beginProfitCloseIdempotency/);
  assert.match(salesRoutes, /requirePasswordConfirmation/);
});

test('CEO Sell Project and project liquidate UI send Idempotency-Key', () => {
  assert.match(adminJs, /Idempotency-Key/);
  assert.match(adminJs, /activeTotalInvestment/);
  assert.match(adminJs, /\/api\/admin\/investments\/\$\{[^}]+\}\/liquidate/);
  assert.match(adminJs, /form\.dataset\.idempotencyKey/);
  assert.match(adminJs, /toFixed\(2\)/);
});

test('monthly project return hard-fails ledger inside a transaction', () => {
  assert.match(financeService, /async function recordMonthlyProjectReturn/);
  assert.match(financeService, /recordMonthlyProjectReturn[\s\S]*withMongoTransaction/);
  assert.doesNotMatch(
    financeService,
    /\[recordMonthlyProjectReturn\] ledger credit failed/
  );
});
