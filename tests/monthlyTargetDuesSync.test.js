'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const monthlyTargetJs = fs.readFileSync(path.join(__dirname, '../services/monthlyTargetService.js'), 'utf8');
const monthlyRoutesJs = fs.readFileSync(path.join(__dirname, '../routes/monthlyTargets.js'), 'utf8');
const memberRoutesJs = fs.readFileSync(path.join(__dirname, '../routes/member.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

test('upsertTarget always syncs dues to all active members by default', () => {
  assert.match(monthlyTargetJs, /async function upsertTarget/);
  assert.match(monthlyTargetJs, /syncDues = true/);
  assert.match(monthlyTargetJs, /duesSync = await syncMonthDues\(key/);
  assert.match(monthlyTargetJs, /async function syncMonthDues/);
  assert.match(monthlyTargetJs, /User\.find\(\{\s*role:\s*'member',\s*status:\s*'active'\s*\}/);
  assert.match(monthlyTargetJs, /getOrCreateMemberDue\(member, yearMonth, target\.amount\)/);
});

test('target write routes advertise member dues propagation', () => {
  assert.match(monthlyRoutesJs, /Propagated to \$\{sync\.synced\} active member/);
  assert.match(monthlyRoutesJs, /propagated to all active member dues/);
  assert.match(monthlyRoutesJs, /syncDues: req\.body\?\.syncDues !== false/);
});

test('member financial API exposes duesDashboard for live UI', () => {
  assert.match(memberRoutesJs, /duesDashboard/);
  assert.match(memberRoutesJs, /arrears\?\.memberDashboard/);
  assert.match(monthlyTargetJs, /currentMonthRequired/);
  assert.match(monthlyTargetJs, /You missed \$\{previousMonthsCount\} previous month\(s\)/);
  assert.match(monthlyTargetJs, /Prior unpaid|totalDue/);
});

test('member dashboard renders required / missed / total due metrics', () => {
  assert.match(memberHtml, /member-dues-section/);
  assert.match(memberHtml, /Live monthly fixed deposit requirement/);
  assert.match(memberJs, /function renderMemberDuesDashboard/);
  assert.match(memberJs, /Current month required/);
  assert.match(memberJs, /Missed previous months/);
  assert.match(memberJs, /Total due amount/);
  assert.match(memberJs, /startMemberDuesLiveSync/);
  assert.match(memberJs, /setInterval/);
  assert.match(stylesCss, /\.member-dues-grid/);
  assert.match(stylesCss, /\.member-dues-metric-total/);
});

test('cashier target save refreshes deposits module after sync', () => {
  assert.match(staffJs, /cashierMonthTargetForm/);
  assert.match(staffJs, /duesSync/);
  assert.match(staffJs, /await loadDepositsModule\(\)/);
  assert.match(staffJs, /syncAfterCashIn/);
});
