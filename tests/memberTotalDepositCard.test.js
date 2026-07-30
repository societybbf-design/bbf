'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberRoutes = fs.readFileSync(path.join(__dirname, '../routes/member.js'), 'utf8');
const en = fs.readFileSync(path.join(__dirname, '../public/locales/en.json'), 'utf8');

test('member dashboard exposes Total Deposit Amount metric card', () => {
  assert.match(memberHtml, /id="memberTotalDepositAmount"/);
  assert.match(memberHtml, /memberUi\.totalDepositAmount/);
  assert.match(memberHtml, /Total Deposit Amount/);
});

test('member financial API returns totalDepositAmount', () => {
  assert.match(memberRoutes, /totalDepositAmount/);
  assert.match(memberJs, /memberTotalDepositAmount/);
  assert.match(memberJs, /totalDepositAmount/);
});

test('locale includes total deposit amount label', () => {
  assert.match(en, /"totalDepositAmount": "Total Deposit Amount"/);
});
