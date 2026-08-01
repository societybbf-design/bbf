'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const inboxJs = fs.readFileSync(path.join(__dirname, '../public/js/approvals-inbox.js'), 'utf8');

test('approvals inbox cards use theme bg-card tokens instead of white fallback only', () => {
  assert.match(inboxJs, /\.approvals-inbox-item\s*\{[\s\S]*?background:\s*var\(--bg-card/);
  assert.match(inboxJs, /\.approvals-inbox-item\s*\{[\s\S]*?color:\s*var\(--text-primary/);
  assert.doesNotMatch(
    inboxJs,
    /\.approvals-inbox-item\s*\{[\s\S]*?background:\s*var\(--card-bg,\s*#fff\)/
  );
});

test('dark mode approvals inbox forces slate cards and bright readable text', () => {
  assert.match(inboxJs, /html\[data-theme="dark"\]\s*\.approvals-inbox-item\s*\{[\s\S]*?#1e293b/);
  assert.match(inboxJs, /html\[data-theme="dark"\]\s*\.approvals-inbox-item-head\s*h3/);
  assert.match(inboxJs, /html\[data-theme="dark"\]\s*\.approvals-inbox-meta/);
  assert.match(inboxJs, /html\[data-theme="dark"\]\s*\.approvals-inbox-actions\s*\.secondary-btn/);
  assert.match(inboxJs, /html\[data-theme="dark"\]\s*\.approvals-inbox-item\s*\.status-badge\.status-pending/);
});
