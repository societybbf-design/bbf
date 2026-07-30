'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInvestmentClosePlan, money } = require('../services/investmentCloseMath');
const { calculateMemberShares } = require('../services/profitService');

const root = path.join(__dirname, '..');
const profitService = fs.readFileSync(path.join(root, 'services/profitService.js'), 'utf8');
const profitRoutes = fs.readFileSync(path.join(root, 'routes/profit.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(root, 'public/js/staff-dashboard.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'views/staff.html'), 'utf8');
const investmentModel = fs.readFileSync(path.join(root, 'models/Investment.js'), 'utf8');
const profitModel = fs.readFileSync(path.join(root, 'models/InvestmentProfit.js'), 'utf8');

test('money helper rounds to 2 decimal places', () => {
  assert.equal(money(10.005), 10.01);
  assert.equal(money(10.004), 10);
  assert.equal(money('12.345'), 12.35);
});

test('computeInvestmentClosePlan handles profit, loss, break-even, and partial', () => {
  const profit = computeInvestmentClosePlan({
    originalAmount: 1000,
    liquidatedPrincipal: 0,
    saleAmount: 1500,
  });
  assert.equal(profit.outcomeType, 'profit');
  assert.equal(profit.profitAmount, 500);
  assert.equal(profit.principalRefund, 1000);
  assert.equal(profit.isPartial, false);

  const loss = computeInvestmentClosePlan({
    originalAmount: 1000,
    liquidatedPrincipal: 0,
    saleAmount: 800,
  });
  assert.equal(loss.outcomeType, 'loss');
  assert.equal(loss.lossAmount, 200);
  assert.equal(loss.principalRefund, 800);

  const even = computeInvestmentClosePlan({
    originalAmount: 1000,
    saleAmount: 1000,
  });
  assert.equal(even.outcomeType, 'break_even');
  assert.equal(even.profitAmount, 0);
  assert.equal(even.lossAmount, 0);

  const partial = computeInvestmentClosePlan({
    originalAmount: 1000,
    liquidatedPrincipal: 200,
    saleAmount: 450,
    principalToClose: 400,
  });
  assert.equal(partial.remaining, 800);
  assert.equal(partial.closePrincipal, 400);
  assert.equal(partial.outcomeType, 'profit');
  assert.equal(partial.profitAmount, 50);
  assert.equal(partial.isPartial, true);
  assert.equal(partial.remainingAfter, 400);
});

test('computeInvestmentClosePlan rejects over-close and empty remaining', () => {
  assert.throws(
    () => computeInvestmentClosePlan({
      originalAmount: 1000,
      liquidatedPrincipal: 1000,
      saleAmount: 10,
    }),
    /no remaining principal/i
  );
  assert.throws(
    () => computeInvestmentClosePlan({
      originalAmount: 1000,
      saleAmount: 100,
      principalToClose: 1200,
    }),
    /exceeds remaining/i
  );
});

test('equal share math stays precise for odd totals', () => {
  const members = [
    { _id: '1', name: 'A', savings: 0, profit: 0 },
    { _id: '2', name: 'B', savings: 0, profit: 0 },
    { _id: '3', name: 'C', savings: 0, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 100, 'equal');
  const total = shares.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(Number(total.toFixed(2)), 100);
});

test('closeInvestmentReturn uses withMongoTransaction and audit fields', () => {
  assert.match(profitService, /async function closeInvestmentReturn/);
  assert.match(profitService, /withMongoTransaction\(async \(session\) =>/);
  assert.match(profitService, /recordAdminActivity/);
  assert.match(profitService, /investment_close_recorded/);
  assert.match(profitService, /liquidatedPrincipal/);
  assert.match(profitService, /isPartial/);
  assert.match(profitService, /creditInbound\(\{[\s\S]*session,/);
});

test('profit routes require idempotency for investment close', () => {
  assert.match(profitRoutes, /beginProfitCloseIdempotency/);
  assert.match(profitRoutes, /Idempotency-Key|clientRequestId/);
  assert.match(profitRoutes, /recordedByUserId/);
  assert.match(profitRoutes, /principalToClose/);
});

test('models support partial liquidation and audit metadata', () => {
  assert.match(investmentModel, /liquidatedPrincipal/);
  assert.match(investmentModel, /cumulativeSaleAmount/);
  assert.match(profitModel, /principalClosed/);
  assert.match(profitModel, /remainingPrincipalAfter/);
  assert.match(profitModel, /isPartial/);
  assert.match(profitModel, /recordedByUserId/);
  assert.match(profitModel, /breakdown/);
  assert.match(profitModel, /break_even/);
});

test('cashier P&L UI has submit lock, confirm, principal close, and idempotency', () => {
  assert.match(staffHtml, /profit-principal-input/);
  assert.match(staffHtml, /profit-remaining-input/);
  assert.match(staffHtml, /id="staffInvestmentProfitSubmitBtn"/);
  assert.match(staffJs, /Idempotency-Key/);
  assert.match(staffJs, /Confirm .+ close/);
  assert.match(staffJs, /submitBtn\.disabled = true/);
  assert.match(staffJs, /Outcome: LOSS/);
  assert.match(staffJs, /principalToClose/);
});
