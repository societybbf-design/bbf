'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const investmentJs = fs.readFileSync(path.join(__dirname, '../services/investmentService.js'), 'utf8');
const contributionModel = fs.readFileSync(path.join(__dirname, '../models/InvestmentContribution.js'), 'utf8');
const advanceJs = fs.readFileSync(path.join(__dirname, '../services/advanceBorrowingService.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const { contributionRemainingDue } = require('../services/advanceBorrowingService');

test('project funding reinvests deposit/savings then profit then advance', () => {
  assert.match(investmentJs, /Fund an investment share-by-share by reinvesting member balances/);
  assert.match(investmentJs, /Deduction order: deposit\/savings → profit → advance/);
  assert.match(investmentJs, /paidFromProfit/);
  assert.match(investmentJs, /fromProfit/);
  assert.match(investmentJs, /member\.profit = Number/);
  assert.match(investmentJs, /\.select\('name email savings profit advanceBalance'\)/);
});

test('InvestmentContribution stores paidFromProfit', () => {
  assert.match(contributionModel, /paidFromProfit/);
});

test('contribution due calc includes paidFromProfit', () => {
  assert.match(advanceJs, /paidFromProfit/);
  assert.equal(contributionRemainingDue({
    expectedAmount: 100,
    paidFromSavings: 40,
    paidFromProfit: 25,
    paidFromAdvance: 10,
    borrowedAmount: 5,
  }), 20);
  assert.match(staffJs, /paidFromProfit/);
  assert.match(staffJs, /deposit\/savings \+ profit \+ advance/);
});
