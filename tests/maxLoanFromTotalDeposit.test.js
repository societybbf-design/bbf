'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateLoanEligibility } = require('../services/loanService');
const loanServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');

test('max loan is 80% of total deposit amount', () => {
  const eligibility = calculateLoanEligibility(10000);
  assert.equal(eligibility.totalDepositAmount, 10000);
  assert.equal(eligibility.maxEligibleAmount, 8000);
  assert.equal(eligibility.theoreticalMaxLoan, 8000);
});

test('loan service builds eligibility from deposit totals not savings balance', () => {
  assert.match(loanServiceJs, /getMemberTotalDepositAmount/);
  assert.match(loanServiceJs, /const totalDepositAmount = await getMemberTotalDepositAmount/);
  assert.doesNotMatch(loanServiceJs, /calculateLoanEligibility\(member\.savings\)/);
  assert.match(loanServiceJs, /80% of total deposits/);
});

test('loans page shows Total Deposit Amount card for max-loan tracking', () => {
  assert.match(memberHtml, /id="loanTotalDepositAmount"/);
  assert.match(memberHtml, /memberUi\.totalDepositAmount/);
  assert.match(memberHtml, /মোট জমার \(Total Deposit\) ৮০%/);
  assert.doesNotMatch(memberHtml, /id="loanTotalSavings"/);
});

test('member UI renders eligibility from totalDepositAmount', () => {
  assert.match(memberJs, /totalDepositAmount/);
  assert.match(memberJs, /fallbackLoanEligibilityFromDeposits/);
  assert.match(memberJs, /মোট জমার ৮০%/);
  assert.doesNotMatch(memberJs, /currentUser\.savings \* 0\.8/);
});
