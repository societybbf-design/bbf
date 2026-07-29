'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const styles = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf8');
const memberHtml = fs.readFileSync(path.join(__dirname, '../views/member.html'), 'utf8');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const adminNotifService = fs.readFileSync(path.join(__dirname, '../services/adminNotificationService.js'), 'utf8');
const adminNotifModel = fs.readFileSync(path.join(__dirname, '../models/AdminNotification.js'), 'utf8');
const financial = fs.readFileSync(path.join(__dirname, '../services/financialNotificationService.js'), 'utf8');
const loanService = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');
const chatService = fs.readFileSync(path.join(__dirname, '../services/chatService.js'), 'utf8');
const adminChatRoutes = fs.readFileSync(path.join(__dirname, '../routes/adminChat.js'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');

test('notification dropdown uses theme-aware surface tokens', () => {
  assert.match(styles, /\.notification-menu\s*\{/);
  assert.match(styles, /\.notification-panel\s*\{[\s\S]*background:\s*var\(--surface-dropdown\)/);
  assert.match(styles, /\.notification-panel\s*\{[\s\S]*color:\s*var\(--text-primary\)/);
  assert.match(styles, /box-shadow:\s*0 12px 40px var\(--shadow-color\)/);
  assert.match(styles, /\.notification-panel\s*\{[\s\S]*?z-index:\s*2100/);
  assert.match(adminHtml, /class="notification-menu"/);
  assert.match(memberHtml, /class="notification-menu"/);
});

test('admin notifications are audience-scoped with personal read state', () => {
  assert.match(adminNotifModel, /targetUser/);
  assert.match(adminNotifModel, /targetRoles/);
  assert.match(adminNotifModel, /readBy/);
  assert.match(adminNotifService, /buildAudienceFilter/);
  assert.match(adminNotifService, /withPersonalRead/);
  assert.match(adminNotifService, /targetRoles/);
});

test('deposit and loan notifications are targeted', () => {
  assert.match(financial, /Deposit confirmations go only to the depositing member/);
  assert.doesNotMatch(financial, /createAdminNotification\(\{\s*type: 'deposit'/);
  assert.match(loanService, /targetRoles:\s*\['ceo'\]/);
  assert.match(loanService, /targetRoles:\s*\['cashier'\]/);
  assert.match(financial, /createMemberNotification\(\{\s*memberId: member\._id/);
});

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
