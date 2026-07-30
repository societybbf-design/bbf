'use strict';

/**
 * Maps notifications to dashboard sections and role-specific deep links.
 * `link` stores a portable section key (e.g. "loans"); `href` is resolved per viewer.
 */

function sectionForNotification({
  type = '',
  relatedModel = '',
  title = '',
  link = '',
} = {}) {
  const stored = String(link || '').trim().replace(/^#/, '');
  if (stored && !stored.startsWith('/')) {
    return stored;
  }

  const model = String(relatedModel || '').toLowerCase();
  const typ = String(type || '').toLowerCase();
  const titleLower = String(title || '').toLowerCase();

  if (typ === 'repayment' || model.includes('loanrepayment')) return 'loans';
  if (typ === 'loan' || model.includes('loanapplication')) return 'loans';
  if (typ === 'withdrawal' || model.includes('withdrawal')) return 'withdrawals';
  if (typ === 'refund' || model.includes('refund')) return 'refunds';
  if (typ === 'deposit' || model.includes('deposit')) return 'deposits';
  if (typ === 'dividend' || model.includes('profit')) return 'profit';
  if (typ === 'kyc' || titleLower.includes('kyc')) return 'settings';
  if (model.includes('memberexit')) return 'members';
  if (model.includes('chatmessage') || titleLower.includes('message from')) return 'messages';
  if (model === 'user' && titleLower.includes('message')) return 'messages';
  if (model.includes('investment')) {
    if (
      titleLower.includes('ready for cashier')
      || titleLower.includes('awaiting cashier')
      || titleLower.includes('cashier payment')
    ) {
      return 'queue';
    }
    return 'projects';
  }
  if (model.includes('monthlycontribution')) return 'deposits';
  return stored || '';
}

function resolveNotificationHref(sectionOrLink, role = '') {
  const raw = String(sectionOrLink || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  const section = raw.replace(/^#/, '');
  const normalizedRole = String(role || '').toLowerCase();

  if (normalizedRole === 'member') {
    const map = {
      loans: 'loans',
      withdrawals: 'withdrawals',
      refunds: 'refunds',
      projects: 'investment-requests',
      investments: 'investments',
      queue: 'investment-requests',
      messages: 'messages',
      chat: 'messages',
      portfolio: 'portfolio',
      profit: 'portfolio',
      deposits: 'portfolio',
      dividend: 'portfolio',
      members: 'settings',
      settings: 'settings',
      approvals: 'investment-requests',
      home: 'dashboard',
      dashboard: 'dashboard',
    };
    return `/member#${map[section] || section}`;
  }

  if (['cashier', 'project_manager', 'employee', 'investor'].includes(normalizedRole)) {
    const map = {
      loans: 'loans',
      withdrawals: 'withdrawals',
      refunds: 'refunds',
      projects: 'investments',
      investments: 'investments',
      queue: 'queue',
      messages: 'chat',
      chat: 'chat',
      profit: 'profit',
      members: 'members',
      settings: 'home',
      approvals: 'approvals',
      'approval-tracking': 'approval-tracking',
      deposits: 'deposits',
      portfolio: 'home',
      home: 'home',
      dashboard: 'home',
    };
    return `/dashboard/${normalizedRole}#${map[section] || section}`;
  }

  // CEO / legacy admin
  const map = {
    loans: 'loans',
    withdrawals: 'withdrawals',
    refunds: 'members',
    projects: 'projects',
    investments: 'projects',
    queue: 'projects',
    messages: 'messages',
    chat: 'messages',
    profit: 'profit',
    members: 'members',
    settings: 'settings',
    approvals: 'approvals',
    deposits: 'members',
    kyc: 'settings',
    home: 'dashboard',
    dashboard: 'dashboard',
  };
  return `/admin#${map[section] || section}`;
}

function enrichNotificationForViewer(doc = {}, role = '') {
  const section = sectionForNotification(doc);
  return {
    ...doc,
    link: section,
    href: resolveNotificationHref(section || doc.link, role),
  };
}

module.exports = {
  sectionForNotification,
  resolveNotificationHref,
  enrichNotificationForViewer,
};
