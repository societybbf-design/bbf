'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/cashier-home.css'), 'utf8');

test('deposits form exposes smart allocation breakdown card markup', () => {
  assert.match(staffHtml, /class="smart-alloc-card/);
  assert.match(staffHtml, /id="cashierDepositSplitPreview"/);
  assert.match(staffHtml, /id="cashierDepositSplitRows"/);
  assert.match(staffHtml, /id="cashierDepositSplitTarget"/);
  assert.match(staffHtml, /id="cashierDepositSplitRemainingDue"/);
  assert.match(staffHtml, /id="cashierDepositSplitTotal"/);
  assert.match(staffHtml, /Smart payment &amp; allocation/);
});

test('staff dashboard renders structured allocation rows from preview API', () => {
  assert.match(staffJs, /function renderSmartAllocRows/);
  assert.match(staffJs, /function setSmartAllocMeta/);
  assert.match(staffJs, /smartAllocKindClass/);
  assert.match(staffJs, /Advance balance \(surplus\)/);
  assert.match(staffJs, /Monthly deposit/);
  assert.match(staffJs, /smart-payment\/preview/);
  assert.doesNotMatch(staffJs, /Loan repayment/);
  assert.doesNotMatch(staffJs, /loan_repayment/);
  assert.doesNotMatch(staffJs, /summary\.toLoan/);
});

test('deposit copy excludes formal loans from smart allocation flow', () => {
  assert.match(staffHtml, /project\/emergency internal dues/);
  assert.match(staffHtml, /Formal loans are not deducted here/);
  assert.doesNotMatch(staffHtml, /→ loan →/);
  assert.match(staffJs, /Formal loans stay in the Loans module/);
});

test('smart allocation card has theme-aware styles', () => {
  assert.match(css, /\.smart-alloc-card\s*\{/);
  assert.match(css, /\.smart-alloc-row\.is-lenders/);
  assert.match(css, /\.smart-alloc-row\.is-monthly/);
  assert.match(css, /\.smart-alloc-row\.is-advance/);
  assert.match(css, /\[data-theme="light"\] \.smart-alloc-card/);
});
