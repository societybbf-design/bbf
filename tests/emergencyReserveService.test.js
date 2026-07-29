'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMemberShares } = require('../services/profitService');
const emergencyReserveService = require('../services/emergencyReserveService');
const { money } = emergencyReserveService;

const serviceJs = fs.readFileSync(path.join(__dirname, '../services/emergencyReserveService.js'), 'utf8');
const routesJs = fs.readFileSync(path.join(__dirname, '../routes/emergencyReserve.js'), 'utf8');
const modelJs = fs.readFileSync(path.join(__dirname, '../models/EmergencyReserveFund.js'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('money helper rounds to two decimals', () => {
  assert.equal(money(10.456), 10.46);
  assert.equal(money(null), 0);
});

test('reserve shares split equally among active members (equal-share society)', () => {
  const members = [
    { _id: 'a', name: 'A', savings: 7000, profit: 0 },
    { _id: 'b', name: 'B', savings: 3000, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 1000, 'proportional');
  assert.equal(shares.length, 2);
  assert.equal(shares[0].amount, 500);
  assert.equal(shares[1].amount, 500);
});

test('equal fallback when all weights are zero', () => {
  const members = [
    { _id: 'a', name: 'A', savings: 0, profit: 0 },
    { _id: 'b', name: 'B', savings: 0, profit: 0 },
  ];
  const shares = calculateMemberShares(members, 100, 'proportional');
  assert.equal(shares[0].amount, 50);
  assert.equal(shares[1].amount, 50);
});

test('emergency reserve routes expose allocate and return-to-book', () => {
  const router = require('../routes/emergencyReserve');
  assert.equal(typeof router, 'function');
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path).sort();
  assert.deepEqual(paths, [
    '/',
    '/allocate',
    '/cover-contribution/:id',
    '/member-shares',
    '/return-to-book',
  ]);
});

test('service exports bidirectional book/reserve transfer helpers', () => {
  assert.equal(typeof emergencyReserveService.allocateFromBookBalance, 'function');
  assert.equal(typeof emergencyReserveService.allocateToBookBalance, 'function');
});

test('allocateToBookBalance debits reserve and credits book ledger', () => {
  const slice = serviceJs.slice(
    serviceJs.indexOf('async function allocateToBookBalance'),
    serviceJs.indexOf('async function assertReserveBalance')
  );
  assert.match(slice, /type:\s*'release'/);
  assert.match(slice, /direction:\s*'debit'/);
  assert.match(slice, /creditInbound/);
  assert.match(slice, /type:\s*'reserve_disbursement'/);
  assert.match(slice, /listMemberReserveShares/);
  assert.match(slice, /Rollback failed reserve→book transfer/);
});

test('EmergencyReserveFund entry enum allows release', () => {
  assert.match(modelJs, /'release'/);
  assert.match(modelJs, /'allocation'/);
});

test('cashier reserve panel has Transfer to Book Balance form', () => {
  assert.match(staffHtml, /Transfer to Book Balance/);
  assert.match(staffHtml, /cashierReserveReturnForm/);
  assert.match(staffHtml, /Reason for reserve release/);
  assert.match(staffJs, /\/return-to-book/);
  assert.match(staffJs, /cashierReserveReturnForm/);
  assert.match(routesJs, /allocateToBookBalance/);
});
