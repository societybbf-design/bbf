'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sectionForNotification,
  resolveNotificationHref,
  enrichNotificationForViewer,
} = require('../services/notificationLinkService');

const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const navJs = fs.readFileSync(path.join(__dirname, '../public/js/notification-nav.js'), 'utf8');
const adminModel = fs.readFileSync(path.join(__dirname, '../models/AdminNotification.js'), 'utf8');
const memberModel = fs.readFileSync(path.join(__dirname, '../models/MemberNotification.js'), 'utf8');

test('all primary dashboards expose a notification bell', () => {
  assert.match(adminHtml, /id="adminNotificationBtn"/);
  assert.match(memberHtml, /id="memberNotificationBtn"/);
  assert.match(staffHtml, /id="staffNotificationBtn"/);
  assert.match(staffHtml, /id="staffNotificationPanel"/);
  assert.match(staffHtml, /notification-nav\.js/);
  assert.match(adminHtml, /notification-nav\.js/);
  assert.match(memberHtml, /notification-nav\.js/);
});

test('notification models and services support deep links', () => {
  assert.match(adminModel, /link:\s*\{/);
  assert.match(memberModel, /link:\s*\{/);
  assert.equal(sectionForNotification({ type: 'loan', relatedModel: 'LoanApplication' }), 'loans');
  assert.equal(sectionForNotification({ type: 'deposit', relatedModel: 'Deposit' }), 'deposits');
  assert.equal(sectionForNotification({
    relatedModel: 'Investment',
    title: 'Investment ready for cashier: INV-1',
  }), 'queue');
  assert.equal(resolveNotificationHref('loans', 'ceo'), '/admin#loans');
  assert.equal(resolveNotificationHref('loans', 'cashier'), '/dashboard/cashier#loans');
  assert.equal(resolveNotificationHref('messages', 'member'), '/member#messages');
  assert.equal(resolveNotificationHref('queue', 'cashier'), '/dashboard/cashier#queue');
  const enriched = enrichNotificationForViewer({
    type: 'loan',
    relatedModel: 'LoanApplication',
    title: 'Loan approved',
  }, 'cashier');
  assert.equal(enriched.link, 'loans');
  assert.equal(enriched.href, '/dashboard/cashier#loans');
});

test('notification clicks mark read and navigate', () => {
  assert.match(navJs, /handleNotificationClick/);
  assert.match(navJs, /data-notification-href/);
  assert.match(navJs, /navigateToHref/);
  assert.match(adminJs, /handleNotificationClick/);
  assert.match(adminJs, /onSameDashboard:\s*\(section\) => navigateToPage\(section\)/);
  assert.match(memberJs, /handleNotificationClick/);
  assert.match(memberJs, /onSameDashboard:\s*\(section\) => navigateMemberPage\(section\)/);
  assert.match(staffJs, /bindStaffNotificationUi/);
  assert.match(staffJs, /loadStaffNotifications/);
  assert.match(staffJs, /showStaffView\(section/);
});
