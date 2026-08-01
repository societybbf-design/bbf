'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  money,
  normalizeOwnership,
  splitByStakeholders,
  computeProjectLiquidationSettlement,
} = require('../services/projectFinanceService');

const root = path.join(__dirname, '..');
const financeService = fs.readFileSync(path.join(root, 'services/projectFinanceService.js'), 'utf8');
const investmentService = fs.readFileSync(path.join(root, 'services/investmentService.js'), 'utf8');
const modelJs = fs.readFileSync(path.join(root, 'models/Investment.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(root, 'routes/investments.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'views/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');

test('normalizeOwnership defaults society 100% / external 0% with empty stakes', () => {
  const result = normalizeOwnership({ amount: 10000 });
  assert.equal(result.societyOwnershipPct, 100);
  assert.equal(result.investorOwnershipPct, 0);
  assert.equal(result.societyAmount, 10000);
  assert.equal(result.externalAmount, 0);
  assert.deepEqual(result.externalInvestors, []);
});

test('normalizeOwnership accepts multiple external investors summing to 100% with society', () => {
  const result = normalizeOwnership({
    amount: 1000,
    societyOwnershipPct: 50,
    externalInvestors: [
      { investorId: 'a'.repeat(24), investorName: 'A', ownershipPct: 30 },
      { investorId: 'b'.repeat(24), investorName: 'B', ownershipPct: 20 },
    ],
  });
  assert.equal(result.societyOwnershipPct, 50);
  assert.equal(result.investorOwnershipPct, 50);
  assert.equal(result.societyAmount, 500);
  assert.equal(result.externalAmount, 500);
  assert.equal(result.externalInvestors.length, 2);
  assert.equal(money(result.societyAmount + result.externalAmount), 1000);
  assert.equal(
    money(result.externalInvestors.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    500
  );
});

test('normalizeOwnership rejects multi-investor ownership that does not equal 100%', () => {
  assert.throws(
    () => normalizeOwnership({
      amount: 1000,
      societyOwnershipPct: 60,
      externalInvestors: [
        { investorId: 'a'.repeat(24), investorName: 'A', ownershipPct: 20 },
      ],
    }),
    /exactly 100%/
  );
});

test('normalizeOwnership rejects duplicate external investors', () => {
  const id = 'c'.repeat(24);
  assert.throws(
    () => normalizeOwnership({
      amount: 1000,
      societyOwnershipPct: 60,
      externalInvestors: [
        { investorId: id, investorName: 'A', ownershipPct: 20 },
        { investorId: id, investorName: 'A', ownershipPct: 20 },
      ],
    }),
    /Duplicate/
  );
});

test('splitByStakeholders preserves total across society and each investor', () => {
  const split = splitByStakeholders(100, {
    societyOwnershipPct: 40,
    investorOwnershipPct: 60,
    externalInvestors: [
      { investor: '1', investorName: 'A', ownershipPct: 25 },
      { investor: '2', investorName: 'B', ownershipPct: 35 },
    ],
  });
  assert.equal(money(split.societyShare + split.investorShare), 100);
  assert.equal(split.investorShares.length, 2);
  assert.equal(
    money(split.investorShares.reduce((sum, row) => sum + Number(row.share || 0), 0)),
    split.investorShare
  );
});

test('liquidation settlement splits profit proportionally across multiple investors with cash conservation', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 1000,
    saleAmount: 1600,
    additionalCosts: 50,
    tax: 50,
    societyOwnershipPct: 50,
    investorOwnershipPct: 50,
    externalInvestors: [
      { investor: '1', investorName: 'A', ownershipPct: 30 },
      { investor: '2', investorName: 'B', ownershipPct: 20 },
    ],
  });
  assert.equal(plan.outcomeType, 'profit');
  assert.equal(plan.investorPayouts.length, 2);
  assert.equal(
    money(plan.societySavingsRefund + plan.investorSaleSettlement + plan.societyProfitShare),
    plan.netProceeds
  );
  assert.equal(
    money(plan.investorPayouts.reduce((sum, row) => sum + Number(row.saleSettlement || 0), 0)),
    plan.investorSaleSettlement
  );
  // 30/20 of 500 profit → 150 / 100; capital 300 / 200
  assert.equal(plan.investorPayouts[0].capitalShare, 300);
  assert.equal(plan.investorPayouts[0].profitShare, 150);
  assert.equal(plan.investorPayouts[0].payout, 450);
  assert.equal(plan.investorPayouts[1].capitalShare, 200);
  assert.equal(plan.investorPayouts[1].profitShare, 100);
  assert.equal(plan.investorPayouts[1].payout, 300);
});

test('liquidation settlement allocates residual cents without breaking conservation', () => {
  const plan = computeProjectLiquidationSettlement({
    capital: 100,
    saleAmount: 133.33,
    societyOwnershipPct: 33,
    investorOwnershipPct: 67,
    externalInvestors: [
      { investor: '1', investorName: 'A', ownershipPct: 33 },
      { investor: '2', investorName: 'B', ownershipPct: 34 },
    ],
  });
  assert.equal(
    money(plan.societySavingsRefund + plan.investorSaleSettlement + plan.societyProfitShare),
    plan.netProceeds
  );
});

test('model and create path persist externalInvestors array', () => {
  assert.match(modelJs, /ExternalInvestorStakeSchema/);
  assert.match(modelJs, /externalInvestors/);
  assert.match(investmentService, /externalInvestors/);
  assert.match(investmentService, /resolvedExternalInvestors/);
  assert.match(routesJs, /externalInvestors/);
});

test('capital expansion copies multi-investor stakes and merges amounts on apply', () => {
  assert.match(investmentService, /expansionExternalInvestors/);
  assert.match(investmentService, /parent\.externalInvestors/);
  assert.match(investmentService, /parentStake\.amount = moneyAmount/);
});

test('monthly return and liquidation wire proportional multi-investor splits', () => {
  assert.match(financeService, /splitByStakeholders/);
  assert.match(financeService, /resolveProjectStakeholders/);
  assert.match(financeService, /stake\.profitBalance/);
  assert.match(financeService, /investorPayouts/);
  assert.match(financeService, /breakdown:\s*\{/);
  assert.match(financeService, /externalInvestors\.\$\[\]\.profitBalance/);
});

test('Create Project UI defaults society 100% and supports multi-investor rows', () => {
  assert.match(adminHtml, /id="projectSocietyPct"[^>]*value="100"/);
  assert.match(adminHtml, /id="projectInvestorPct"[^>]*value="0"/);
  assert.match(adminHtml, /id="projectExternalInvestorRows"/);
  assert.match(adminHtml, /id="projectAddInvestorBtn"/);
  assert.doesNotMatch(adminHtml, /id="projectInvestorSelect"\s+required/);
  assert.match(adminJs, /function addProjectExternalInvestorRow/);
  assert.match(adminJs, /function collectProjectExternalInvestorRows/);
  assert.match(adminJs, /resetProjectExternalInvestorRows/);
  assert.match(adminJs, /externalInvestors:/);
  assert.match(adminJs, /exactly 100%/);
});
