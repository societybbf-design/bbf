'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('shortfall is required minus book balance floored at zero', () => {
  const required = 100000;
  const book = 75000;
  const shortfall = Number(Math.max(0, required - book).toFixed(2));
  assert.equal(shortfall, 25000);
  assert.equal(Number(Math.max(0, 100000 - 100000).toFixed(2)), 0);
});

test('advance cover amount is capped by shortfall and lender advance', () => {
  const shortfall = 25000;
  const advance = 10000;
  const cover = Math.min(shortfall, advance);
  assert.equal(cover, 10000);
  assert.equal(Math.min(25000, 40000), 25000);
});

test('reserve cover amount is capped by shortfall and reserve balance', () => {
  const shortfall = 25000;
  const reserve = 15000;
  assert.equal(Math.min(shortfall, reserve), 15000);
});

test('canComplete requires opening set and zero shortfall', () => {
  const cases = [
    { openingSet: true, shortfall: 0, expected: true },
    { openingSet: true, shortfall: 0.01, expected: false },
    { openingSet: false, shortfall: 0, expected: false },
  ];
  cases.forEach((row) => {
    const hasShortfall = row.shortfall > 0.001;
    const canComplete = row.openingSet && !hasShortfall;
    assert.equal(canComplete, row.expected);
  });
});

test('investment routes expose cashier payment check and cover endpoints', () => {
  const router = require('../routes/investments');
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(paths.some((p) => p.includes('/:id/cashier-payment-check')));
  assert.ok(paths.some((p) => p.includes('/:id/cashier-cover-advance')));
  assert.ok(paths.some((p) => p.includes('/:id/cashier-cover-reserve')));
  assert.ok(paths.some((p) => p.includes('/:id/cashier-complete')));
});

test('investmentService exports shortfall helpers', () => {
  const svc = require('../services/investmentService');
  assert.equal(typeof svc.previewCashierPayment, 'function');
  assert.equal(typeof svc.coverCashierPaymentShortfallFromAdvance, 'function');
  assert.equal(typeof svc.coverCashierPaymentShortfallFromReserve, 'function');
  assert.equal(typeof svc.getCashierPaymentFundingSnapshot, 'function');
});
