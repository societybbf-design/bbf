'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '../public/css/cashier-home.css'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../public/js/staff-dashboard.js'), 'utf8');

test('approval-track cards use theme tokens instead of hardcoded light backgrounds', () => {
  assert.match(css, /\.approval-track-card\s*\{[\s\S]*?background:\s*var\(--bg-card/);
  assert.match(css, /\.approval-track-card\s*\{[\s\S]*?color:\s*var\(--text-primary/);
  assert.doesNotMatch(
    css,
    /\.approval-track-card\s*\{[\s\S]*?background:\s*linear-gradient\(180deg,\s*rgba\(248,\s*250,\s*252/
  );
});

test('dark mode approval-track cards force slate background and bright text', () => {
  assert.match(css, /html\[data-theme="dark"\]\s*\.approval-track-card\s*\{[\s\S]*?--bg-card,\s*#1e293b/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.approval-track-card\s*\{[\s\S]*?--text-primary,\s*#f8fafc/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.approval-track-card\s*\.table-subtitle/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.approval-track-details\s*summary/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.approval-track-card\s*\.status-badge\.status-pending/);
});

test('Projects / Investments tracking still renders approval-track-card markup', () => {
  assert.match(staffJs, /function renderProjectApprovalTrackingCard/);
  assert.match(staffJs, /class="approval-track-card"/);
  assert.match(staffJs, /View who approved \/ who to contact/);
});
