'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const styles = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const chatService = fs.readFileSync(path.join(__dirname, '../services/chatService.js'), 'utf8');
const adminChatRoutes = fs.readFileSync(path.join(__dirname, '../routes/adminChat.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');

test('staff messaging APIs and recipient selection exist', () => {
  assert.match(chatService, /getStaffChatDirectory/);
  assert.match(chatService, /sendStaffMessage/);
  assert.match(adminChatRoutes, /\/staff-directory/);
  assert.match(adminChatRoutes, /\/staff\/:userId\/messages/);
  assert.match(staffHtml, /cashierChatRecipientSelect/);
  assert.match(staffHtml, /data-cashier-chat-tab="staff"/);
  assert.match(adminHtml, /adminChatRecipientSelect/);
  assert.match(adminHtml, /data-admin-chat-tab="staff"/);
  assert.match(staffJs, /openCashierChat/);
  assert.match(staffJs, /\/api\/admin\/chat\/staff\//);
  assert.match(adminJs, /openAdminStaffChatConversation/);
  assert.match(adminJs, /\/api\/admin\/chat\/staff-directory/);
});

test('chat compose uses theme tokens for legibility', () => {
  assert.match(styles, /\.chat-compose-form textarea\s*\{[\s\S]*background:\s*var\(--surface-input\)/);
  assert.match(styles, /\.chat-compose-form textarea\s*\{[\s\S]*color:\s*var\(--text-primary\)/);
  assert.match(styles, /\.chat-recipient-select/);
});

test('in-app notification system is fully removed', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../models/AdminNotification.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../models/MemberNotification.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../services/adminNotificationService.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../services/memberNotificationService.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../services/notificationLinkService.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../routes/adminNotifications.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../routes/memberNotifications.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../public/js/notification-nav.js')), false);
  assert.doesNotMatch(adminHtml, /notification-menu|adminNotificationBtn/);
  assert.doesNotMatch(memberHtml, /notification-menu|memberNotificationBtn/);
  assert.doesNotMatch(staffHtml, /notification-menu|staffNotificationBtn/);
  assert.doesNotMatch(adminJs, /\/api\/admin\/notifications/);
});
