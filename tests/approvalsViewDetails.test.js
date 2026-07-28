'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('approvals inbox view details no longer dumps raw JSON', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');
  assert.equal(source.includes('JSON.stringify(data'), false);
  assert.equal(source.includes('<pre'), false);
  assert.equal(source.includes('extractInvestmentDetails'), true);
  assert.equal(source.includes('detailsHtml(item, data)'), true);
});

test('approvals inbox service attaches readable investment details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/approvalsInboxService.js'), 'utf8');
  assert.equal(source.includes('projectCode: inv.investmentCode'), true);
  assert.equal(source.includes('investor: inv.investor?.name'), true);
});
