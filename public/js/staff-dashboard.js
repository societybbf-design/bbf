/**
 * staff-dashboard.js — Cashier / staff workspace
 * All sidebar modules stay on /dashboard/* — never redirect to /admin (CEO panel).
 */

function t(key, fallback) {
  return window.I18n?.t?.(key, fallback) ?? fallback;
}

function translateStatus(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  const map = {
    active: 'status.active',
    inactive: 'status.inactive',
    blocked: 'status.blocked',
    deleted: 'status.deleted',
    pending: 'status.pending',
    approved: 'status.approved',
    rejected: 'status.rejected',
    paid: 'status.paid',
    unpaid: 'status.unpaid',
    partial: 'status.partial',
    due: 'status.due',
    completed: 'status.completed',
    cancelled: 'status.cancelled',
    canceled: 'status.cancelled',
    running: 'status.running',
    sold: 'status.sold',
    profit: 'status.profit',
    loss: 'status.loss',
    success: 'status.success',
    failed: 'status.failed',
  };
  return map[key] ? t(map[key], raw) : raw;
}

const ROLE_META = {
  project_manager: {
    title: 'Project Manager Dashboard',
    subtitle: 'Oversee members, investments, loans, and KYC workflows.',
  },
  cashier: {
    title: 'Cashier Dashboard',
    subtitle: 'Handle deposits, withdrawals, refunds, loan payouts, bank ledger, Profit & Loss, and investment payments.',
  },
  employee: {
    title: 'Employee Dashboard',
    subtitle: 'Support member records, KYC, and reporting tasks.',
  },
  investor: {
    title: 'Investor Dashboard',
    subtitle: 'View society reports and investment-related summaries.',
  },
};

/** panel = in-page staff view id (data-staff-view). Never /admin. */
const FEATURE_CATALOG = [
  { key: 'can_manage_members', title: 'Members', detail: 'View society members.', icon: '👥', panel: 'members' },
  { key: 'can_manage_deposits', title: 'Deposits', detail: 'Record member deposits and receipts.', icon: '💵', panel: 'deposits' },
  { key: 'can_manage_deposits', title: 'Advances & Borrowing', detail: 'Advance balances, unpaid shares, internal borrow & settle.', icon: '🔄', panel: 'funding', catalogKey: 'funding' },
  { key: 'can_manage_withdrawals', title: 'Withdrawals', detail: 'Review withdrawal requests.', icon: '🏦', panel: 'withdrawals' },
  { key: 'can_disburse_loans', title: 'Loans', detail: 'Disburse approved loans and record repayments.', icon: '📄', panel: 'loans' },
  { key: 'can_manage_loans', title: 'Loan Review', detail: 'View pending loan applications (CEO approves).', icon: '📄', panel: 'loans', catalogKey: 'loan_review' },
  { key: 'can_manage_investments', title: 'Investments', detail: 'Investment summary and payment queue.', icon: '📈', panel: 'investments' },
  { key: 'can_manage_ious', title: 'IOUs', detail: 'Investment-related tracking.', icon: '📝', panel: 'investments' },
  { key: 'can_manage_profit', title: 'Profit & Loss', detail: 'Record investment P&L, distribute profits, and automatic dividends.', icon: '💹', panel: 'profit' },
  { key: 'can_manage_refunds', title: 'Refunds', detail: 'Create member refunds.', icon: '↩️', panel: 'refunds' },
  { key: 'can_manage_kyc', title: 'KYC', detail: 'KYC is handled in Settings workflows.', icon: '🪪', panel: 'home' },
  { key: 'can_view_reports', title: 'Reports', detail: 'Society summaries and Z-report.', icon: '📊', panel: 'reports' },
  { key: 'can_manage_notices', title: 'Notices', detail: 'Notices are managed from your home workspace.', icon: '📢', panel: 'home' },
  { key: 'can_manage_chat', title: 'Chat', detail: 'Member conversations.', icon: '💬', panel: 'chat' },
];

let staffSessionUser = null;
let staffMembersCache = [];
let staffInvestorsCache = [];
let staffCurrentView = null;
let staffCanManageLedger = false;
let staffViewLoadToken = 0;
const staffViewCache = new Map();
const STAFF_VIEW_CACHE_TTL_MS = 20000;
let auditState = { offset: 0, hasMore: false, filters: {} };
let activeMemberProfileId = null;
let activeInvestorProfileId = null;

function isStaffViewCacheFresh(viewId) {
  const entry = staffViewCache.get(viewId);
  return Boolean(entry && (Date.now() - entry.at) < STAFF_VIEW_CACHE_TTL_MS);
}

function markStaffViewCache(viewId) {
  staffViewCache.set(viewId, { at: Date.now() });
}

function invalidateStaffViewCache(viewIds = null) {
  if (!viewIds) {
    staffViewCache.clear();
    return;
  }
  viewIds.forEach((id) => staffViewCache.delete(id));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `${formatMoney(Number(value || 0), 2)}`;
}

function buildQueryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function triggerPdfDownload(button, url, options = {}) {
  if (window.PdfLanguage?.triggerDownload) {
    return window.PdfLanguage.triggerDownload(button, url, options);
  }
  if (!button || button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = window.I18n?.t('pdf.generating', 'Generating PDF…');
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = original;
  }, 900);
}

function auditDirectionClass(direction) {
  return direction === 'in' ? 'audit-direction-in' : 'audit-direction-out';
}

let cashierFinancialTrendChart = null;

function renderFinancialTrendChart(canvasId, trends) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined' || !trends) return;
  if (cashierFinancialTrendChart) cashierFinancialTrendChart.destroy();
  cashierFinancialTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trends.labels || [],
      datasets: [
        {
          label: 'Cash in',
          data: trends.series?.revenueIn || [],
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.08)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Payouts out',
          data: trends.series?.payoutsOut || [],
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220, 38, 38, 0.06)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Profit distributions',
          data: trends.series?.profitDistributions || [],
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15, 118, 110, 0.06)',
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

async function loadCashierFinancialTrends() {
  try {
    const response = await fetch('/api/admin/analytics/financial-trends');
    const trends = await response.json();
    if (!response.ok) throw new Error(trends.error);
    renderFinancialTrendChart('cashierFinancialTrendChart', trends);
  } catch (error) {
    // Chart is optional on home dashboard
  }
}

function paymentChannelLabel(channel) {
  const labels = { cash: 'Cash', bank: 'Bank', mfs: 'MFS' };
  return labels[channel] || channel || 'Cash';
}

function navItemHtml({ titleKey, icon, active = false, panel = 'home' }) {
  const label = window.I18n?.t(titleKey, titleKey) || titleKey;
  return `
    <a href="#${escapeHtml(panel)}" class="nav-item${active ? ' active' : ''}" data-staff-nav="${escapeHtml(panel)}">
      <span class="nav-icon-wrap"><span class="nav-icon" aria-hidden="true">${icon}</span></span>
      <span class="nav-label" data-i18n="${escapeHtml(titleKey)}">${escapeHtml(label)}</span>
    </a>
  `;
}

const PANEL_I18N_KEYS = {
  home: 'nav.dashboard',
  approvals: 'nav.approvals',
  members: 'nav.members',
  ledger: 'nav.bankLedger',
  audit: 'nav.transactionAudit',
  tracking: 'nav.cashierTracking',
  queue: 'nav.paymentQueue',
  funding: 'nav.advancesBorrow',
  reserve: 'nav.emergencyReserve',
  profit: 'nav.profitLoss',
  deposits: 'nav.deposits',
  withdrawals: 'nav.withdrawals',
  investments: 'nav.investments',
  refunds: 'nav.refunds',
  loans: 'nav.loans',
  reports: 'nav.reports',
  chat: 'nav.chat',
  ious: 'nav.ious',
};

const HOME_MODULE_ORDER = [
  'deposits',
  'withdrawals',
  'funding',
  'profit',
  'reports',
  'refunds',
  'chat',
];

const HOME_MODULE_COPY = {
  deposits: { title: 'Deposits', detail: 'Record member deposits', icon: '🪙' },
  withdrawals: { title: 'Withdrawals', detail: 'Review payout requests', icon: '↗️' },
  funding: { title: 'Advances & Borrowing', detail: 'Advances, unpaid shares & settle', icon: '🔄' },
  profit: { title: 'Profit & Loss', detail: 'Investment P&L, distributions & dividends', icon: '💹' },
  reports: { title: 'Reports', detail: 'Society summaries & Z-report', icon: '📊' },
  refunds: { title: 'Refunds', detail: 'Create member refunds', icon: '↩️' },
  chat: { title: 'Chat', detail: 'Message society members', icon: '💬' },
  ledger: { title: 'Bank Ledger', detail: 'Book balance & reconciliation', icon: '🏛️' },
  queue: { title: 'Payment Queue', detail: 'Investment payment queue', icon: '⏳' },
  members: { title: 'Members', detail: 'View society members', icon: '👥' },
  loans: { title: 'Loans', detail: 'Review loan applications', icon: '📄' },
  investments: { title: 'Investments', detail: 'Investment summary', icon: '📈' },
};

function featureCardHtml(feature, index = 0) {
  const copy = HOME_MODULE_COPY[feature.panel] || {};
  const title = copy.title || feature.title;
  const detail = copy.detail || feature.detail;
  const icon = copy.icon || feature.icon || '•';
  const accent = index === 0 ? ' is-accent' : '';
  return `
    <button type="button" class="cashier-module-card${accent}" data-staff-nav="${escapeHtml(feature.panel)}">
      <span class="cashier-module-icon" aria-hidden="true">${icon}</span>
      <h3>${escapeHtml(title)}</h3>
      <p class="cashier-module-detail">${escapeHtml(detail)}</p>
      <p class="cashier-module-cta">Open module →</p>
    </button>
  `;
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function greetingForHour(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatLedgerLabel(entry) {
  const type = String(entry.type || 'entry').replace(/_/g, ' ');
  const dir = entry.direction === 'out' ? 'OUT' : 'IN';
  return `${type} ${dir} · ${money(entry.amount)}`;
}

async function loadCashierHomeKpis({ force = false } = {}) {
  const recentEl = document.getElementById('cashierRecentLedger');
  try {
    const [metricsRes, reportRes, trendsRes] = await Promise.all([
      fetch('/api/admin/bank-ledger/cashier-metrics'),
      fetch('/api/admin/monthly-targets/contribution-report'),
      fetch('/api/admin/analytics/financial-trends'),
    ]);
    const data = await metricsRes.json();
    if (!metricsRes.ok) throw new Error(data.error || 'Unable to load metrics.');

    const projects = Number(data.activeProjects || 0);
    const sales = Number(data.salesUnits || 0);
    const members = Math.max(1, Number(data.activeMembers || 1));

    document.getElementById('kpiActiveProjects').textContent = String(projects);
    document.getElementById('kpiSalesUnits').textContent = String(sales);
    document.getElementById('kpiTotalInvestment').textContent = money(data.totalInvestment);
    document.getElementById('kpiProfitGenerated').textContent = money(data.profitGenerated);
    document.getElementById('kpiBookBalance').textContent = money(data.bookBalance);

    const projectRing = document.querySelector('.cashier-ring[data-ring="projects"]');
    const salesRing = document.querySelector('.cashier-ring[data-ring="sales"]');
    if (projectRing) {
      projectRing.style.setProperty('--progress', String(Math.min(100, Math.round((projects / Math.max(projects, 8)) * 100) || 12)));
    }
    if (salesRing) {
      salesRing.style.setProperty('--progress', String(Math.min(100, Math.round((sales / Math.max(sales, members * 2, 10)) * 100) || 18)));
    }

    const entries = data.recentLedger || [];
    if (!entries.length) {
      recentEl.innerHTML = '<li class="text-secondary">No ledger activity yet.</li>';
    } else {
      recentEl.innerHTML = entries.map((entry) => {
        const time = entry.createdAt
          ? new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '—';
        return `
          <li>
            <span class="cashier-history-icon" aria-hidden="true">${entry.direction === 'out' ? '↓' : '↑'}</span>
            <span>${escapeHtml(formatLedgerLabel(entry))}${entry.note ? `<br><span class="text-secondary">${escapeHtml(entry.note)}</span>` : ''}</span>
            <small>${escapeHtml(time)}</small>
          </li>
        `;
      }).join('');
    }

    if (reportRes.ok) {
      const report = await reportRes.json();
      renderCashierContributionSummary(report);
    } else {
      const err = await reportRes.json().catch(() => ({}));
      renderCashierContributionSummary(null, err.error || 'Unable to load monthly contribution status.');
    }

    if (trendsRes.ok) {
      const trends = await trendsRes.json().catch(() => null);
      if (trends) renderFinancialTrendChart('cashierFinancialTrendChart', trends);
    }
  } catch (error) {
    if (recentEl) recentEl.innerHTML = `<li class="text-secondary">${escapeHtml(error.message)}</li>`;
    renderCashierContributionSummary(null, error.message);
  }
}

function shortMemberId(id) {
  const value = String(id || '');
  if (!value) return '—';
  return value.slice(-8).toUpperCase();
}

function renderMemberStatusList(rows, type) {
  if (!rows.length) {
    return `<li class="text-secondary">${type === 'paid' ? t('staffUi.noMembersPaid', 'No members fully paid yet.') : t('staffUi.everyonePaid', 'Everyone is paid up.')}</li>`;
  }
  return rows.slice(0, 12).map((row) => {
    const member = row.member || {};
    const id = row.memberId || member._id || member.id;
    const amount = type === 'paid' ? money(row.amount) : money(row.unpaidAmount);
    const meta = type === 'paid'
      ? (row.status === 'partial' ? 'Partial' : 'Paid')
      : (row.status === 'partial' ? 'Partial' : 'Due');
    return `
      <li>
        <button type="button" class="cashier-status-member" data-open-home-member="${escapeHtml(String(id))}">
          <span class="cashier-status-avatar" aria-hidden="true">${escapeHtml(initialsFromName(member.name))}</span>
          <span class="cashier-status-copy">
            <strong>${escapeHtml(member.name || 'Member')}</strong>
            <small>${escapeHtml(meta)} · ID ${escapeHtml(shortMemberId(id))}</small>
          </span>
          <span class="cashier-status-amount">${amount}</span>
        </button>
      </li>
    `;
  }).join('') + (rows.length > 12
    ? `<li class="text-secondary">+${rows.length - 12} more — open Members for the full list</li>`
    : '');
}

function renderCashierContributionSummary(report, errorMessage) {
  const paidList = document.getElementById('cashierPaidList');
  const unpaidList = document.getElementById('cashierUnpaidList');
  if (!paidList || !unpaidList) return;

  if (!report) {
    paidList.innerHTML = `<li class="text-secondary">${escapeHtml(errorMessage || t('staffUi.unableToLoad', 'Unable to load.'))}</li>`;
    unpaidList.innerHTML = `<li class="text-secondary">${escapeHtml(errorMessage || t('staffUi.unableToLoad', 'Unable to load.'))}</li>`;
    return;
  }

  const paidCount = Number(report.paidCount || 0);
  const unpaidCount = Number(report.unpaidCount || 0);
  const paidTotal = Number(report.paidTotal || 0);
  const unpaidTotal = Number(report.unpaidTotal || 0);
  const totalMembers = Math.max(paidCount + unpaidCount, 1);
  const rate = Math.round((paidCount / totalMembers) * 100);
  const maxAmount = Math.max(paidTotal, unpaidTotal, 1);

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('cashierPaidCount', String(paidCount));
  setText('cashierUnpaidCount', String(unpaidCount));
  setText('cashierPaidTotal', money(paidTotal));
  setText('cashierUnpaidTotal', money(unpaidTotal));
  setText('cashierPaidSubtitle', `Paid in ${report.monthLabel || 'this month'}`);
  setText('cashierUnpaidSubtitle', `Outstanding in ${report.monthLabel || 'this month'}`);
  setText('cashierAnalyticsNote', `Collection status for ${report.monthLabel || 'the current month'}`);
  setText('cashierCollectionRate', `${rate}%`);
  setText('cashierLegendPaid', String(paidCount));
  setText('cashierLegendUnpaid', String(unpaidCount));
  setText('cashierBarPaidLabel', money(paidTotal));
  setText('cashierBarUnpaidLabel', money(unpaidTotal));
  setText(
    'cashierMonthTarget',
    report.expectedAmount != null ? money(report.expectedAmount) : 'Not set'
  );

  const ring = document.getElementById('cashierCollectionRing');
  if (ring) ring.style.setProperty('--paid-pct', String(rate));

  const paidBar = document.getElementById('cashierBarPaid');
  const unpaidBar = document.getElementById('cashierBarUnpaid');
  if (paidBar) paidBar.style.width = `${Math.round((paidTotal / maxAmount) * 100)}%`;
  if (unpaidBar) unpaidBar.style.width = `${Math.round((unpaidTotal / maxAmount) * 100)}%`;

  paidList.innerHTML = renderMemberStatusList(report.paid || [], 'paid');
  unpaidList.innerHTML = renderMemberStatusList(report.unpaid || [], 'unpaid');

  document.querySelectorAll('[data-open-home-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void openCashierMemberProfile(btn.dataset.openHomeMember);
    });
  });
}


function enhanceTableCards(root = document) {
  root.querySelectorAll('table.table-cards, table.data-table').forEach((table) => {
    if (!table.classList.contains('table-cards')) {
      table.classList.add('table-cards');
    }
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!headers.length) return;
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName !== 'TD') return;
        if (!cell.getAttribute('data-label') && headers[index]) {
          cell.setAttribute('data-label', headers[index]);
        }
      });
    });
  });
}

function showStaffView(viewId, { forceReload = false } = {}) {
  const next = viewId || 'home';
  const prev = staffCurrentView;
  const sameView = prev === next;
  const cacheFresh = isStaffViewCacheFresh(next);

  if (prev === 'chat' && next !== 'chat') {
    stopCashierChatPolling();
  }

  staffCurrentView = next;

  // Instant panel switch — never wait on network before painting.
  document.querySelectorAll('[data-staff-view]').forEach((el) => {
    const active = el.dataset.staffView === next;
    el.classList.toggle('hidden', !active);
    if (active) {
      el.classList.toggle('is-loading-view', forceReload || !sameView || !cacheFresh);
      el.setAttribute('aria-busy', forceReload || !sameView || !cacheFresh ? 'true' : 'false');
    } else {
      el.classList.remove('is-loading-view');
      el.removeAttribute('aria-busy');
    }
  });

  document.querySelectorAll('[data-staff-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.staffNav === next);
  });

  if (window.location.hash.replace(/^#/, '') !== next) {
    window.history.replaceState(null, '', `#${next}`);
  }

  // Close mobile sidebar immediately so nav feels instantaneous.
  window.SocietyHubSidebar?.close?.();

  if (sameView && !forceReload && cacheFresh) {
    return;
  }

  const token = ++staffViewLoadToken;
  const panel = document.querySelector(`[data-staff-view="${next}"]`);

  Promise.resolve(loadViewData(next)).then(() => {
    if (token !== staffViewLoadToken) return;
    markStaffViewCache(next);
  }).finally(() => {
    if (token !== staffViewLoadToken) return;
    panel?.classList.remove('is-loading-view');
    panel?.setAttribute('aria-busy', 'false');
    if (panel) enhanceTableCards(panel);
  });
}

async function loadViewData(viewId) {
  switch (viewId) {
    case 'home':
      await loadCashierHomeKpis();
      await refreshStaffApprovalsBadge();
      return undefined;
    case 'ledger':
      return loadBankLedger();
    case 'queue':
      return loadCashierQueue();
    case 'profit':
      return loadProfitPool();
    case 'deposits':
      return loadDepositsModule();
    case 'funding':
      return loadFundingModule();
    case 'reserve':
      return loadEmergencyReserveModule();
    case 'withdrawals':
      return loadWithdrawalsModule();
    case 'refunds':
      return loadRefundsModule();
    case 'reports':
      return loadReportsModule();
    case 'audit':
      return loadAuditModule();
    case 'tracking':
      return loadStaffCashierTracking();
    case 'chat':
      return loadChatModule();
    case 'members':
      return loadMembersModule();
    case 'loans':
      return loadLoansModule();
    case 'investments':
      return loadInvestmentsModule();
    case 'approvals':
      return loadStaffApprovalsInbox();
    default:
      return undefined;
  }
}

async function loadStaffApprovalsInbox() {
  if (!window.ApprovalsInbox?.loadAndRender) return;
  await window.ApprovalsInbox.loadAndRender('staffApprovalsInbox', {
    badgeSelector: '[data-staff-nav="approvals"]',
    onNavigate: (panel) => showStaffView(panel),
  });
}

async function refreshStaffApprovalsBadge() {
  if (!window.ApprovalsInbox?.refreshBadge) return;
  await window.ApprovalsInbox.refreshBadge('[data-staff-nav="approvals"]');
}

function bindStaffNavigation() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-staff-nav]');
    if (!trigger) return;
    const panel = trigger.dataset.staffNav;
    if (!panel) return;
    event.preventDefault();
    showStaffView(panel);
  });

  window.addEventListener('hashchange', () => {
    const hash = (window.location.hash || '#home').replace(/^#/, '') || 'home';
    showStaffView(hash);
  });
}

async function ensureMembersOptions(selectIds = []) {
  if (!staffMembersCache.length) {
    const response = await fetch('/api/admin/members');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load members.');
    staffMembersCache = data.members || [];
  }
  selectIds.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Select member…</option>${staffMembersCache.map((m) => `
      <option value="${m._id || m.id}">${escapeHtml(m.name)} (${escapeHtml(m.email || '')})</option>
    `).join('')}`;
    if (current) select.value = current;
  });
}

function renderLedger(data) {
  const bookEl = document.getElementById('ledgerBookBalance');
  const actualEl = document.getElementById('ledgerActualBalance');
  const diffEl = document.getElementById('ledgerDifference');
  const alertEl = document.getElementById('ledgerMismatchAlert');
  const openingWrap = document.getElementById('ledgerOpeningFormWrap');
  const tbody = document.getElementById('ledgerEntriesBody');

  if (bookEl) bookEl.textContent = money(data.bookBalance);
  if (actualEl) {
    actualEl.textContent = data.actualBalance === null || data.actualBalance === undefined
      ? '—'
      : money(data.actualBalance);
  }
  if (diffEl) {
    diffEl.textContent = data.difference === null || data.difference === undefined
      ? '—'
      : money(data.difference);
  }
  if (alertEl) {
    if (data.mismatched) {
      alertEl.classList.remove('hidden');
      alertEl.textContent = `Mismatch alert: book balance ${money(data.bookBalance)} differs from actual ${money(data.actualBalance)} by ${money(data.difference)}.`;
    } else {
      alertEl.classList.add('hidden');
      alertEl.textContent = '';
    }
  }
  if (openingWrap) openingWrap.classList.toggle('hidden', Boolean(data.openingSet));
  if (tbody) {
    const entries = data.entries || [];
    tbody.innerHTML = entries.length
      ? entries.map((entry) => `
        <tr>
          <td>${escapeHtml(new Date(entry.createdAt).toLocaleString())}</td>
          <td>${escapeHtml(entry.type)}</td>
          <td>${escapeHtml(entry.direction)}</td>
          <td>${money(entry.amount)}</td>
          <td>${money(entry.balanceAfter)}</td>
          <td>${escapeHtml(entry.note || '—')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="6">No ledger entries yet.</td></tr>';
  }
}

function applyLiveBookBalance(bookBalance) {
  if (bookBalance === null || bookBalance === undefined || Number.isNaN(Number(bookBalance))) return;
  const formatted = money(bookBalance);
  ['ledgerBookBalance', 'cashierDepositsBookBalance', 'profitPoolBookBalance'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatted;
  });
}

async function loadBankLedger() {
  const messageEl = document.getElementById('ledgerMessage');
  try {
    const response = await fetch('/api/admin/bank-ledger');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load bank ledger.');
    renderLedger(data);
    applyLiveBookBalance(data.bookBalance);
    return data;
  } catch (error) {
    if (messageEl) messageEl.textContent = error.message;
    return null;
  }
}

/**
 * After any cash-in (deposit / advance / sale / monthly profit), refresh only what is visible.
 */
async function syncAfterCashIn({ memberId = null, bookBalance = null } = {}) {
  applyLiveBookBalance(bookBalance);
  staffMembersCache = [];
  invalidateStaffViewCache(['home', 'deposits', 'funding', 'profit', 'ledger', 'members', 'reports', 'queue']);

  const tasks = [];
  const current = staffCurrentView;

  if (current === 'deposits') {
    tasks.push(loadDepositsModule({ skipLedgerFetch: bookBalance != null }).catch(() => {}));
  } else if (current === 'funding') {
    tasks.push(loadFundingModule().catch(() => {}));
  } else if (current === 'profit') {
    tasks.push(loadProfitPool({ skipLedgerFetch: bookBalance != null }).catch(() => {}));
  } else if (current === 'ledger') {
    tasks.push(loadBankLedger().catch(() => {}));
  } else if (current === 'home' || current === 'members' || current === 'reports' || current === 'queue') {
    tasks.push(loadViewData(current).catch(() => {}));
  } else if (bookBalance == null) {
    tasks.push(loadBankLedger().catch(() => {}));
  }

  if (tasks.length) {
    await Promise.all(tasks);
    if (current) markStaffViewCache(current);
  }

  const modal = document.getElementById('cashierMemberProfileModal');
  if (memberId && modal && !modal.classList.contains('hidden')) {
    await openCashierMemberProfile(memberId);
  }
}

async function loadProfitPool(options = {}) {
  const messageEl = document.getElementById('profitPoolMessage');
  const balanceEl = document.getElementById('profitPoolBalance');
  const recentEl = document.getElementById('profitPoolRecent');
  try {
    const fetches = [fetch('/api/admin/profit-pool')];
    if (!options.skipLedgerFetch) {
      fetches.push(fetch('/api/admin/bank-ledger'));
    }
    const responses = await Promise.all(fetches);
    const response = responses[0];
    const ledgerRes = responses[1];
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load profit pool.');
    if (balanceEl) balanceEl.textContent = money(data.balance);
    if (ledgerRes) {
      const ledgerData = await ledgerRes.json();
      if (ledgerRes.ok) applyLiveBookBalance(ledgerData.bookBalance);
    }
    if (recentEl) {
      const dists = data.recentDistributions || [];
      recentEl.innerHTML = dists.length
        ? `<h3>Recent distributions</h3><ul class="profit-pool-list">${dists.map((d) => `
            <li>${escapeHtml(new Date(d.createdAt).toLocaleString())} · ${money(d.totalAmount)} · ${d.memberCount || 0} members
              · <a href="/api/admin/profit-pool/distributions/${d._id}/report.pdf" target="_blank" rel="noopener">PDF report</a></li>
          `).join('')}</ul>`
        : '<p class="text-secondary">No distributions yet.</p>';
    }
  } catch (error) {
    if (messageEl) messageEl.textContent = error.message;
  }

  await Promise.all([
    loadStaffInvestmentProfitHistory(),
    loadStaffProfitHistory(),
    loadStaffProfitMemberStatus(),
  ]);
}

async function loadStaffInvestmentProfitHistory() {
  const list = document.getElementById('staffInvestmentProfitHistoryList');
  if (!list) return;
  try {
    const response = await fetch('/api/admin/profit/investment-history');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      list.innerHTML = `<tr><td colspan="7">${escapeHtml(data.error || 'Unable to load investment profit history.')}</td></tr>`;
      return;
    }
    const records = data.records || [];
    if (!records.length) {
      list.innerHTML = '<tr><td colspan="7">No investment profit records yet.</td></tr>';
      return;
    }
    list.innerHTML = records.map((item) => {
      const isLoss = item.outcomeType === 'loss';
      const amount = Number(item.profitAmount || 0);
      return `
        <tr>
          <td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td>
          <td>${escapeHtml(item.investmentCode || '-')}</td>
          <td>${money(item.investmentAmount)}</td>
          <td>${money(item.saleAmount)}</td>
          <td>${isLoss ? '-' : ''}${money(amount)}</td>
          <td>${isLoss ? 'Loss' : 'Profit'}</td>
          <td>${escapeHtml(item.notes || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    list.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadStaffProfitHistory() {
  const list = document.getElementById('staffProfitHistoryList');
  const lastEl = document.getElementById('staffLastProfitDistribution');
  if (!list && !lastEl) return;
  try {
    const response = await fetch('/api/admin/profit/history');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (list) list.innerHTML = `<tr><td colspan="5">${escapeHtml(data.error || 'Unable to load profit history.')}</td></tr>`;
      return;
    }
    const distributions = data.distributions || [];
    if (lastEl) {
      if (!distributions.length) {
        lastEl.textContent = 'Last distribution: Not yet distributed';
      } else {
        const latest = distributions[0];
        lastEl.textContent = `Last distribution: ${money(latest.totalAmount)} on ${new Date(latest.createdAt).toLocaleString()} (Equal Share)`;
      }
    }
    if (!list) return;
    if (!distributions.length) {
      list.innerHTML = '<tr><td colspan="5">No profit distributions yet.</td></tr>';
      return;
    }
    list.innerHTML = distributions.map((item) => `
      <tr>
        <td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td>
        <td>${money(item.totalAmount)}</td>
        <td>Equal Share</td>
        <td>${item.memberCount || 0}</td>
        <td>${escapeHtml(item.notes || '-')}</td>
      </tr>
    `).join('');
  } catch (error) {
    if (list) list.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadStaffProfitMemberStatus() {
  const list = document.getElementById('staffProfitMemberStatusList');
  if (!list) return;
  try {
    const response = await fetch('/api/admin/members');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      list.innerHTML = `<tr><td colspan="4">${escapeHtml(data.error || 'Unable to load members.')}</td></tr>`;
      return;
    }
    const members = (data.members || []).filter((m) => (m.status || 'active') === 'active');
    if (!members.length) {
      list.innerHTML = '<tr><td colspan="4">No active members yet.</td></tr>';
      return;
    }
    list.innerHTML = members.map((member) => `
      <tr>
        <td>${escapeHtml(member.name || '-')}</td>
        <td>${escapeHtml(member.email || '-')}</td>
        <td>${money(member.savings)}</td>
        <td>${money(member.profit)}</td>
      </tr>
    `).join('');
  } catch (error) {
    list.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
}

let cashierPaymentShortfallState = {
  investmentId: null,
  funding: null,
  onDone: null,
};

/**
 * Force-create the Complete payment modal if the page markup is missing/stale.
 * Must run synchronously on click so the cashier always sees a popup.
 */
function ensureCashierPaymentShortfallModal() {
  let modal = document.getElementById('cashierPaymentShortfallModal');
  if (modal && document.getElementById('cashierPaymentShortfallContent')) {
    modal.style.zIndex = '9000';
    return modal;
  }

  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'cashierPaymentShortfallModal';
  modal.className = 'modal hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'cashierPaymentShortfallTitle');
  modal.style.zIndex = '9000';
  modal.innerHTML = `
    <div class="modal-content modal-large">
      <div class="modal-header">
        <div>
          <h2 id="cashierPaymentShortfallTitle">Complete project payment</h2>
          <p class="table-subtitle" id="cashierPaymentShortfallSubtitle">Check book balance, fix any shortfall, then complete payment.</p>
        </div>
        <div class="modal-header-actions">
          <button type="button" class="modal-close" id="cashierPaymentShortfallClose" aria-label="Close">&times;</button>
        </div>
      </div>
      <div id="cashierPaymentShortfallContent" class="member-profile-content">
        <p class="text-secondary">Checking funding…</p>
      </div>
      <p id="cashierPaymentShortfallMessage" class="message"></p>
      <div class="inline-actions u-mt-1" style="justify-content:flex-end;gap:0.5rem;flex-wrap:wrap;">
        <button type="button" class="secondary-btn" id="cashierPaymentShortfallCancel">Cancel</button>
        <button type="button" class="primary-btn" id="cashierPaymentShortfallComplete" disabled>Complete payment</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  // Re-bind after force-create (dataset.bound may belong to a removed node).
  const stale = document.getElementById('cashierPaymentShortfallModal');
  if (stale) delete stale.dataset.bound;
  bindCashierPaymentShortfallModal();
  return modal;
}

function closeCashierPaymentShortfallModal(result = null) {
  const modal = document.getElementById('cashierPaymentShortfallModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = '';
  }
  const onDone = cashierPaymentShortfallState.onDone;
  cashierPaymentShortfallState = { investmentId: null, funding: null, onDone: null };
  const msg = document.getElementById('cashierPaymentShortfallMessage');
  if (msg) {
    msg.textContent = '';
    msg.classList.remove('success', 'error');
  }
  if (typeof onDone === 'function') {
    try {
      onDone(result);
    } catch (_) {
      // ignore callback errors
    }
  }
}

function setCashierPaymentShortfallMessage(text, isError = false) {
  const msg = document.getElementById('cashierPaymentShortfallMessage');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', Boolean(isError && text));
  msg.classList.toggle('success', Boolean(!isError && text));
}

function renderCashierPaymentShortfallModal(funding) {
  const content = document.getElementById('cashierPaymentShortfallContent');
  const completeBtn = document.getElementById('cashierPaymentShortfallComplete');
  const subtitle = document.getElementById('cashierPaymentShortfallSubtitle');
  const titleEl = document.getElementById('cashierPaymentShortfallTitle');
  if (!content) return;

  cashierPaymentShortfallState.funding = funding;
  cashierPaymentShortfallState.investmentId = funding.investmentId || funding.investment?._id || cashierPaymentShortfallState.investmentId;

  const shortMembers = Array.isArray(funding.memberFunding?.shortMembers)
    ? funding.memberFunding.shortMembers
    : [];
  const hasMemberProblems = Boolean(funding.hasMemberProblems || shortMembers.length);
  const canFinish = Boolean(funding.canCompleteDirectly);
  const advances = Array.isArray(funding.advanceMembers) ? funding.advanceMembers : [];

  if (titleEl) {
    titleEl.textContent = canFinish
      ? 'Ready to complete payment'
      : (hasMemberProblems ? 'Member account short — cover then complete' : 'Fix payment problem, then complete');
  }
  if (subtitle) {
    subtitle.textContent = canFinish
      ? 'All member accounts are balanced. Confirm below to complete payment.'
      : (hasMemberProblems
        ? 'One or more members cannot cover their share or monthly contribution. Cover the gap below, then complete payment.'
        : (!funding.openingSet
          ? 'Bank opening balance is not set. Fix it in Bank Ledger, then try again.'
          : 'Book balance is short. Cover the gap from advance or Emergency / Reserve Fund, then complete payment.'));
  }

  const lenderOptions = advances.length
    ? advances.map((m) => `
        <option value="${escapeHtml(String(m.id))}" data-advance="${Number(m.advanceBalance || 0)}">
          ${escapeHtml(m.name || '')} — advance ${money(m.advanceBalance)}
        </option>
      `).join('')
    : '<option value="">No members with advance balance</option>';

  const shortMemberOptions = shortMembers.length
    ? shortMembers.map((m, idx) => `
        <option value="${escapeHtml(String(m.id))}" data-cover="${Number(m.coverSuggested || 0)}" ${idx === 0 ? 'selected' : ''}>
          ${escapeHtml(m.name || '')} — gap ${money(m.coverSuggested)}
        </option>
      `).join('')
    : '<option value="">No short members</option>';

  const defaultMemberCover = shortMembers.length ? Number(shortMembers[0].coverSuggested || 0) : 0;
  const defaultBookCover = Number(funding.shortfall || 0);
  const showMemberCover = hasMemberProblems && funding.openingSet;
  const showBookCover = Boolean(funding.hasShortfall && funding.openingSet && !canFinish);

  const shortMembersTable = shortMembers.length ? `
    <div class="panel-card u-mb-1" style="border-left:4px solid #d97706;">
      <h3>Equal-share audit — accounts that are short</h3>
      <p class="table-subtitle">
        Project ${money(funding.requiredAmount)} ÷ ${Number(funding.memberFunding?.memberCount || shortMembers.length)} members
        = <strong>${money(funding.equalShareBase || funding.memberFunding?.equalShareBase || 0)}</strong> each.
        Deficit = equal share − (savings + advance).
      </p>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Equal share</th>
              <th>Available</th>
              <th>Exact deficit</th>
              <th>Month unpaid</th>
            </tr>
          </thead>
          <tbody>
            ${shortMembers.map((m) => `
              <tr>
                <td>${escapeHtml(m.name || '')}<br><span class="text-secondary">${escapeHtml(m.email || '')}</span></td>
                <td>${money(m.expectedShare)}</td>
                <td>${money(m.available)} <span class="text-secondary">(sav ${money(m.savings)} + adv ${money(m.advanceBalance)})</span></td>
                <td class="message error"><strong>${money(m.shareDeficit)}</strong></td>
                <td class="${Number(m.monthlyUnpaid || 0) > 0 ? 'message error' : ''}">${money(m.monthlyUnpaid)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="table-subtitle">Total equal-share deficit: <strong>${money(funding.memberFunding?.totalShareDeficit || 0)}</strong></p>
    </div>
  ` : '';

  const statusBanner = canFinish
    ? `<div class="panel-card u-mb-1" style="border-left:4px solid #059669;">
         <p><strong>No funding problem.</strong> You can complete payment now.</p>
       </div>`
    : !funding.openingSet
      ? `<div class="panel-card u-mb-1" style="border-left:4px solid #d97706;">
           <p><strong>Bank opening balance is not set.</strong> Set it in Bank Ledger first.</p>
           <p class="u-mt-1"><button type="button" class="secondary-btn" id="cashierShortfallOpenLedger">Open Bank Ledger</button></p>
         </div>`
      : `<div class="panel-card u-mb-1" style="border-left:4px solid #d97706;">
           <p><strong>Payment cannot complete yet.</strong> ${escapeHtml(funding.message || 'Solve the shortfall below, then click Complete payment.')}</p>
         </div>`;

  content.innerHTML = `
    ${statusBanner}
    <div class="panel-card u-mb-1">
      <p><strong>Project:</strong> ${escapeHtml(funding.investmentCode || funding.investment?.investmentCode || '—')}</p>
      <p><strong>Required (society):</strong> ${money(funding.requiredAmount)}</p>
      <p><strong>Equal share per member:</strong> ${money(funding.equalShareBase || funding.memberFunding?.equalShareBase || 0)}
        <span class="text-secondary">(${Number(funding.memberFunding?.memberCount || 0)} active members)</span></p>
      <p><strong>Current book balance:</strong> ${money(funding.bookBalance)}</p>
      <p><strong>Book shortfall:</strong> <span class="${funding.hasShortfall ? 'message error' : 'message success'}">${money(funding.shortfall)}</span></p>
      <p><strong>Emergency / Reserve Fund:</strong> ${money(funding.reserveBalance)}</p>
      <p><strong>Opening balance set:</strong> ${funding.openingSet ? 'Yes' : 'No — set it in Bank Ledger first'}</p>
      <p class="table-subtitle">${escapeHtml(funding.message || '')}</p>
    </div>

    ${shortMembersTable}

    ${showMemberCover ? `
    <div class="form-row-2">
      <div class="panel-card">
        <h3>Internal borrow (from advance)</h3>
        <p class="table-subtitle">Move advance from a funded member into the short member's savings.</p>
        <form id="cashierShortfallAdvanceForm" class="add-member-form">
          <input type="hidden" name="coverMode" value="member" />
          <div class="form-group">
            <label>Short member
              <select name="borrowerId" id="cashierShortfallBorrower" required>
                ${shortMemberOptions}
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Lender (advance available)
              <select name="lenderId" id="cashierShortfallLender" required ${advances.length ? '' : 'disabled'}>
                ${lenderOptions}
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Amount (৳)
              <input type="number" name="amount" id="cashierShortfallAdvanceAmount" min="0.01" step="0.01"
                value="${defaultMemberCover > 0 && advances.length ? Math.min(defaultMemberCover, Number(advances[0]?.advanceBalance || defaultMemberCover)).toFixed(2) : ''}"
                ${advances.length ? 'required' : 'disabled'} />
            </label>
          </div>
          <button type="submit" class="secondary-btn" ${advances.length ? '' : 'disabled'}>
            Apply advance cover
          </button>
        </form>
      </div>

      <div class="panel-card">
        <h3>Emergency / Reserve Fund</h3>
        <p class="table-subtitle">Credit the short member's savings from the reserve fund.</p>
        <form id="cashierShortfallReserveForm" class="add-member-form">
          <input type="hidden" name="coverMode" value="member" />
          <div class="form-group">
            <label>Short member
              <select name="memberId" id="cashierShortfallReserveMember" required>
                ${shortMemberOptions}
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Amount (৳)
              <input type="number" name="amount" id="cashierShortfallReserveAmount" min="0.01" step="0.01"
                value="${defaultMemberCover > 0 ? Math.min(defaultMemberCover, Number(funding.reserveBalance || 0)).toFixed(2) : ''}"
                ${Number(funding.reserveBalance || 0) > 0 ? 'required' : 'disabled'} />
            </label>
          </div>
          <button type="submit" class="secondary-btn" ${Number(funding.reserveBalance || 0) > 0 ? '' : 'disabled'}>
            Apply reserve cover
          </button>
        </form>
      </div>
    </div>
    ` : ''}

    ${showBookCover ? `
    <div class="form-row-2 u-mt-1">
      <div class="panel-card">
        <h3>Cover book shortfall (advance)</h3>
        <p class="table-subtitle">Release a member's advance into the society book.</p>
        <form id="cashierShortfallBookAdvanceForm" class="add-member-form">
          <input type="hidden" name="coverMode" value="book" />
          <div class="form-group">
            <label>Lender (advance available)
              <select name="lenderId" required ${advances.length ? '' : 'disabled'}>
                ${lenderOptions}
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Amount (৳)
              <input type="number" name="amount" min="0.01" step="0.01"
                value="${defaultBookCover > 0 && advances.length ? Math.min(defaultBookCover, Number(advances[0]?.advanceBalance || defaultBookCover)).toFixed(2) : ''}"
                ${advances.length ? 'required' : 'disabled'} />
            </label>
          </div>
          <button type="submit" class="secondary-btn" ${advances.length ? '' : 'disabled'}>Apply book cover</button>
        </form>
      </div>
      <div class="panel-card">
        <h3>Cover book shortfall (reserve)</h3>
        <form id="cashierShortfallBookReserveForm" class="add-member-form">
          <input type="hidden" name="coverMode" value="book" />
          <div class="form-group">
            <label>Amount (৳)
              <input type="number" name="amount" min="0.01" step="0.01"
                value="${defaultBookCover > 0 ? Math.min(defaultBookCover, Number(funding.reserveBalance || 0)).toFixed(2) : ''}"
                ${Number(funding.reserveBalance || 0) > 0 ? 'required' : 'disabled'} />
            </label>
          </div>
          <button type="submit" class="secondary-btn" ${Number(funding.reserveBalance || 0) > 0 ? '' : 'disabled'}>Apply book reserve cover</button>
        </form>
      </div>
    </div>
    ` : ''}
  `;

  if (completeBtn) {
    completeBtn.disabled = !canFinish;
    completeBtn.textContent = canFinish
      ? 'Complete payment now'
      : (hasMemberProblems
        ? 'Complete payment (cover member gaps first)'
        : (!funding.openingSet
          ? 'Complete payment (set opening balance first)'
          : 'Complete payment (fix shortfall first)'));
  }

  document.getElementById('cashierShortfallOpenLedger')?.addEventListener('click', () => {
    closeCashierPaymentShortfallModal({ completed: false, cancelled: true, openLedger: true });
    const ledgerNav = document.querySelector('[data-staff-nav="ledger"]');
    if (ledgerNav) ledgerNav.click();
    else window.location.hash = 'ledger';
  });

  const syncMemberCoverAmount = (selectId, amountId) => {
    const selected = document.getElementById(selectId)?.selectedOptions?.[0];
    const amountInput = document.getElementById(amountId);
    const cover = Number(selected?.dataset?.cover || 0);
    if (amountInput && cover > 0) amountInput.value = cover.toFixed(2);
  };
  document.getElementById('cashierShortfallBorrower')?.addEventListener('change', () => {
    syncMemberCoverAmount('cashierShortfallBorrower', 'cashierShortfallAdvanceAmount');
  });
  document.getElementById('cashierShortfallReserveMember')?.addEventListener('change', () => {
    syncMemberCoverAmount('cashierShortfallReserveMember', 'cashierShortfallReserveAmount');
  });

  document.getElementById('cashierShortfallLender')?.addEventListener('change', (event) => {
    const selected = event.target.selectedOptions?.[0];
    const advance = Number(selected?.dataset?.advance || 0);
    const amountInput = document.getElementById('cashierShortfallAdvanceAmount');
    const borrowerSelected = document.getElementById('cashierShortfallBorrower')?.selectedOptions?.[0];
    const cover = Number(borrowerSelected?.dataset?.cover || cashierPaymentShortfallState.funding?.shortfall || 0);
    if (amountInput && cover > 0) {
      amountInput.value = Math.min(cover, advance).toFixed(2);
      amountInput.max = String(advance);
    }
  });

  const postCover = async (url, body) => {
    setCashierPaymentShortfallMessage('');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to apply cover.');
    setCashierPaymentShortfallMessage(data.message || 'Cover applied.', false);
    renderCashierPaymentShortfallModal(data.funding || data);
  };

  document.getElementById('cashierShortfallAdvanceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const investmentId = cashierPaymentShortfallState.investmentId;
    const formData = new FormData(event.target);
    try {
      await postCover(`/api/admin/investments/${investmentId}/cashier-cover-advance`, {
        lenderId: formData.get('lenderId'),
        borrowerId: formData.get('borrowerId'),
        amount: formData.get('amount'),
      });
    } catch (error) {
      setCashierPaymentShortfallMessage(error.message, true);
    }
  });

  document.getElementById('cashierShortfallReserveForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const investmentId = cashierPaymentShortfallState.investmentId;
    const formData = new FormData(event.target);
    try {
      await postCover(`/api/admin/investments/${investmentId}/cashier-cover-reserve`, {
        memberId: formData.get('memberId'),
        amount: formData.get('amount'),
      });
    } catch (error) {
      setCashierPaymentShortfallMessage(error.message, true);
    }
  });

  document.getElementById('cashierShortfallBookAdvanceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const investmentId = cashierPaymentShortfallState.investmentId;
    const formData = new FormData(event.target);
    try {
      await postCover(`/api/admin/investments/${investmentId}/cashier-cover-advance`, {
        lenderId: formData.get('lenderId'),
        amount: formData.get('amount'),
      });
    } catch (error) {
      setCashierPaymentShortfallMessage(error.message, true);
    }
  });

  document.getElementById('cashierShortfallBookReserveForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const investmentId = cashierPaymentShortfallState.investmentId;
    const formData = new FormData(event.target);
    try {
      await postCover(`/api/admin/investments/${investmentId}/cashier-cover-reserve`, {
        amount: formData.get('amount'),
      });
    } catch (error) {
      setCashierPaymentShortfallMessage(error.message, true);
    }
  });
}

async function openCashierPaymentShortfallModal(investmentId, {
  onDone = null,
  preloaded = null,
  preloadedError = null,
} = {}) {
  // Open the popup immediately (before any await) when a problem must be shown.
  const modal = ensureCashierPaymentShortfallModal();
  bindCashierPaymentShortfallModal();
  const content = document.getElementById('cashierPaymentShortfallContent');
  if (!modal || !content) {
    throw new Error('Payment popup could not be created. Refresh the page and try again.');
  }

  cashierPaymentShortfallState.onDone = onDone;
  cashierPaymentShortfallState.investmentId = String(investmentId || '');
  content.innerHTML = '<p class="text-secondary">Checking member accounts and book balance…</p>';
  setCashierPaymentShortfallMessage('');
  const titleEl = document.getElementById('cashierPaymentShortfallTitle');
  const subtitle = document.getElementById('cashierPaymentShortfallSubtitle');
  if (titleEl) titleEl.textContent = 'Complete project payment';
  if (subtitle) subtitle.textContent = 'Checking member contributions and book balance…';
  const completeBtn = document.getElementById('cashierPaymentShortfallComplete');
  if (completeBtn) {
    completeBtn.disabled = true;
    completeBtn.textContent = 'Complete payment';
  }
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  if (preloadedError) {
    content.innerHTML = `
      <div class="panel-card" style="border-left:4px solid #dc2626;">
        <p><strong>Unable to start payment.</strong></p>
        <p class="message error">${escapeHtml(preloadedError)}</p>
      </div>
    `;
    setCashierPaymentShortfallMessage(preloadedError, true);
    return null;
  }

  if (preloaded) {
    renderCashierPaymentShortfallModal(preloaded);
    return preloaded;
  }

  try {
    const res = await fetch(`/api/admin/investments/${encodeURIComponent(investmentId)}/cashier-payment-check`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      content.innerHTML = `
        <div class="panel-card" style="border-left:4px solid #dc2626;">
          <p><strong>Unable to start payment.</strong></p>
          <p class="message error">${escapeHtml(data.error || 'Unable to check payment funding.')}</p>
          <p class="table-subtitle">Close this popup, fix the issue, then click Complete payment again.</p>
        </div>
      `;
      setCashierPaymentShortfallMessage(data.error || 'Unable to check payment funding.', true);
      return null;
    }
    renderCashierPaymentShortfallModal(data);
    return data;
  } catch (error) {
    content.innerHTML = `
      <div class="panel-card" style="border-left:4px solid #dc2626;">
        <p><strong>Unable to start payment.</strong></p>
        <p class="message error">${escapeHtml(error.message || String(error))}</p>
      </div>
    `;
    setCashierPaymentShortfallMessage(error.message || String(error), true);
    return null;
  }
}

async function executeCashierCompletePayment(investmentId, { messageEl } = {}) {
  const res = await fetch(`/api/admin/investments/${investmentId}/cashier-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Payment completed by cashier' }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || 'Unable to complete payment.');
    err.funding = payload.funding || null;
    err.code = payload.code || null;
    throw err;
  }
  if (messageEl) {
    messageEl.classList.remove('error');
    messageEl.classList.add('success');
    messageEl.textContent = payload.message || 'Payment completed.';
    if (payload.voucherUrl) {
      messageEl.innerHTML += ` <a href="${escapeHtml(payload.voucherUrl)}" target="_blank" rel="noopener">Download voucher PDF</a>`;
    }
  }
  closeCashierPaymentShortfallModal({ completed: true, payload });
  invalidateStaffViewCache(['queue', 'home', 'investments', 'ledger', 'funding', 'reserve', 'approvals']);
  await loadCashierQueue().catch(() => {});
  if (typeof window.ApprovalsInbox?.loadAndRender === 'function') {
    const approvalsBox = document.getElementById('staffApprovalsInbox')
      || document.querySelector('[data-approvals-inbox]');
    if (approvalsBox) {
      await window.ApprovalsInbox.loadAndRender(approvalsBox).catch(() => {});
    }
  }
  return payload;
}

/**
 * Conditional Complete payment:
 * - If every member account/contribution is balanced and book balance is enough,
 *   complete payment directly (no problem popup).
 * - Only open the interactive modal when a member deficit or book shortfall exists.
 */
async function beginCashierCompletePayment(investmentId, { messageEl = null, onDone = null } = {}) {
  const id = String(investmentId || '').trim();
  if (!id || id === 'undefined' || id === 'null') {
    throw new Error('Investment id is missing for Complete payment.');
  }

  const finish = (result) => {
    if (typeof onDone === 'function') {
      try { onDone(result); } catch (_) { /* ignore */ }
    }
    return result;
  };

  const checkRes = await fetch(`/api/admin/investments/${encodeURIComponent(id)}/cashier-payment-check`);
  const check = await checkRes.json().catch(() => ({}));
  if (!checkRes.ok) {
    // Show the problem in the modal so the cashier is never left with a silent failure.
    await openCashierPaymentShortfallModal(id, {
      onDone,
      preloadedError: check.error || 'Unable to check payment funding.',
    });
    return null;
  }

  if (check.canCompleteDirectly) {
    try {
      const payload = await executeCashierCompletePayment(id, { messageEl });
      return finish({ completed: true, payload });
    } catch (error) {
      if (error.funding && (error.funding.needsPopup || error.funding.hasMemberProblems || error.funding.hasShortfall)) {
        await openCashierPaymentShortfallModal(id, {
          onDone,
          preloaded: error.funding,
        });
        return null;
      }
      throw error;
    }
  }

  // Member/book problem — open interactive cover popup only when needed.
  await openCashierPaymentShortfallModal(id, {
    onDone,
    preloaded: check,
  });
  return null;
}

window.beginCashierCompletePayment = beginCashierCompletePayment;
window.openCashierPaymentShortfallModal = openCashierPaymentShortfallModal;
window.ensureCashierPaymentShortfallModal = ensureCashierPaymentShortfallModal;

function bindCashierPaymentShortfallModal() {
  const modal = document.getElementById('cashierPaymentShortfallModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';

  document.getElementById('cashierPaymentShortfallClose')?.addEventListener('click', () => {
    closeCashierPaymentShortfallModal({ completed: false, cancelled: true });
  });
  document.getElementById('cashierPaymentShortfallCancel')?.addEventListener('click', () => {
    closeCashierPaymentShortfallModal({ completed: false, cancelled: true });
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeCashierPaymentShortfallModal({ completed: false, cancelled: true });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeCashierPaymentShortfallModal({ completed: false, cancelled: true });
    }
  });

  document.getElementById('cashierPaymentShortfallComplete')?.addEventListener('click', async () => {
    const investmentId = cashierPaymentShortfallState.investmentId;
    if (!investmentId) return;
    const funding = cashierPaymentShortfallState.funding;
    if (!funding?.canCompleteDirectly) {
      setCashierPaymentShortfallMessage(
        funding?.hasMemberProblems
          ? 'Cover every short member account before completing payment.'
          : 'Cover the full shortfall before completing payment.',
        true
      );
      return;
    }
    const completeBtn = document.getElementById('cashierPaymentShortfallComplete');
    if (completeBtn) completeBtn.disabled = true;
    setCashierPaymentShortfallMessage('Completing payment…');
    try {
      const queueMsg = document.getElementById('cashierQueueMessage');
      const approvalsMsg = document.querySelector('#staffApprovalsInbox [data-approvals-message], [data-approvals-inbox] [data-approvals-message]');
      await executeCashierCompletePayment(investmentId, { messageEl: queueMsg || approvalsMsg });
    } catch (error) {
      if (error.funding) {
        renderCashierPaymentShortfallModal(error.funding);
      }
      setCashierPaymentShortfallMessage(error.message, true);
      if (completeBtn) completeBtn.disabled = false;
    }
  });
}

async function loadCashierQueue() {
  const list = document.getElementById('cashierQueueList');
  const messageEl = document.getElementById('cashierQueueMessage');
  if (!list) return;

  if (!list.dataset.hasContent) {
    list.innerHTML = '<p class="text-secondary">Loading payment queue…</p>';
  }

  try {
    const response = await fetch('/api/admin/investments/cashier-queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load payment queue.');
    const queue = data.queue || [];
    if (!queue.length) {
      list.innerHTML = '<p class="text-secondary">No investments awaiting cashier payment.</p>';
      list.dataset.hasContent = '1';
    } else {
    list.innerHTML = queue.map((item) => {
      const docs = (item.documents || []).map((doc) => `
        <li><a href="${doc.filePath}" target="_blank" rel="noopener">${escapeHtml(doc.originalName || 'Document')}</a></li>
      `).join('') || '<li>No documents</li>';
      const tracking = item.approvalTracking || {};
      const receiver = item.payoutReceiver || {};
      return `
        <article class="feature-card payout-queue-card" style="margin-bottom: 0.85rem;">
          <h3>${escapeHtml(item.investmentCode || 'Investment')}</h3>
          <p>${escapeHtml(item.investmentType || '')} · <strong>${money(item.amount)}</strong></p>
          <p>Approved ${tracking.approvedCount || 0}/${tracking.totalMembers || 0}</p>
          <div class="payout-receiver-box">
            <strong>Payee</strong>
            <p>Name: ${escapeHtml(receiver.name || item.investorName || '—')}</p>
            <p>Role: ${escapeHtml(receiver.role || '—')}</p>
            <p>Email: ${escapeHtml(receiver.email || '—')}</p>
            <p>Account name: ${escapeHtml(receiver.accountName || '—')}</p>
            <p>Account number: ${escapeHtml(receiver.accountNumber || '—')}</p>
            <p>Bank: ${escapeHtml(receiver.bankName || '—')}</p>
          </div>
          <ul>${docs}</ul>
          <button type="button" class="primary-btn" data-complete-payment="${escapeHtml(String(item._id || ''))}">Complete Payment</button>
        </article>
      `;
    }).join('');
    list.dataset.hasContent = '1';

    list.querySelectorAll('[data-complete-payment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (messageEl) {
          messageEl.textContent = '';
          messageEl.classList.remove('success', 'error');
        }
        btn.disabled = true;
        try {
          const result = await new Promise((resolve, reject) => {
            beginCashierCompletePayment(btn.dataset.completePayment, {
              messageEl,
              onDone: (done) => resolve(done || { completed: false, cancelled: true }),
            }).catch(reject);
          });
          if (result?.completed) {
            if (messageEl) {
              messageEl.classList.remove('error');
              messageEl.classList.add('success');
              messageEl.textContent = result.payload?.message || 'Payment completed.';
            }
          } else if (messageEl && !result?.openLedger) {
            messageEl.classList.remove('success');
            messageEl.textContent = 'Payment popup closed. Fix any problem, then try Complete payment again.';
          }
        } catch (error) {
          if (messageEl) {
            messageEl.classList.remove('success');
            messageEl.classList.add('error');
            messageEl.textContent = error.message;
          }
        } finally {
          btn.disabled = false;
        }
      });
    });
    }
  } catch (error) {
    if (messageEl) messageEl.textContent = error.message;
  }

  await Promise.all([
    loadCashierExitQueue().catch(() => {}),
    loadCashierExternalCapitalQueue().catch(() => {}),
    loadCashierMonthlyProjects().catch(() => {}),
  ]);
}

async function loadCashierExternalCapitalQueue() {
  const list = document.getElementById('cashierExternalCapitalList');
  const messageEl = document.getElementById('cashierExternalCapitalMessage');
  if (!list) return;
  try {
    const response = await fetch('/api/admin/investments/external-capital-queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load external capital queue.');
    const queue = data.queue || [];
    if (!queue.length) {
      list.innerHTML = '<p class="text-secondary">No co-funded projects awaiting external capital.</p>';
      return;
    }
    list.innerHTML = queue.map((item) => `
      <article class="feature-card payout-queue-card" style="margin-bottom: 0.85rem;">
        <h3>${escapeHtml(item.investmentCode || 'Project')}</h3>
        <p>${escapeHtml(item.investorName || item.investor?.name || 'Investor')} · External share <strong>${money(item.externalAmount)}</strong> (${Number(item.investorOwnershipPct || 0)}%)</p>
        <p class="table-subtitle">Total ${money(item.amount)} · Society ${Number(item.societyOwnershipPct || 0)}% · ${escapeHtml(item.returnMode === 'monthly' ? 'Monthly return' : 'Fixed/term')}</p>
        <form class="cashier-external-capital-form add-member-form" data-investment-id="${item._id}">
          <div class="form-row-2">
            <div class="form-group">
              <label>Amount (৳)
                <input type="number" name="amount" min="0.01" step="0.01" value="${Number(item.externalAmount || 0).toFixed(2)}" required />
              </label>
            </div>
            <div class="form-group">
              <label>Reference
                <input type="text" name="paymentReference" placeholder="Bank/MFS ref" />
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>Note
              <input type="text" name="note" placeholder="Optional note" />
            </label>
          </div>
          <button type="submit" class="primary-btn">Record External Investment</button>
          <p class="message cashier-external-capital-msg"></p>
        </form>
      </article>
    `).join('');

    list.querySelectorAll('.cashier-external-capital-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const msg = form.querySelector('.cashier-external-capital-msg');
        const formData = new FormData(form);
        if (msg) msg.textContent = '';
        try {
          const res = await fetch(`/api/admin/investments/${form.dataset.investmentId}/external-capital`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: formData.get('amount'),
              paymentReference: formData.get('paymentReference'),
              note: formData.get('note'),
              paymentChannel: 'bank',
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to record external capital.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = payload.message || 'External capital recorded.';
          }
          if (messageEl) {
            messageEl.classList.add('success');
            messageEl.textContent = payload.message || 'External capital recorded.';
          }
          await loadCashierExternalCapitalQueue();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadCashierMonthlyProjects() {
  const list = document.getElementById('cashierMonthlyProjectsList');
  const messageEl = document.getElementById('cashierMonthlyProjectsMessage');
  if (!list) return;
  try {
    const response = await fetch('/api/admin/investments/monthly-projects');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load monthly projects.');
    const projects = data.projects || [];
    if (!projects.length) {
      list.innerHTML = '<p class="text-secondary">No active monthly-return projects.</p>';
      return;
    }
    list.innerHTML = projects.map((item) => `
      <article class="feature-card payout-queue-card" style="margin-bottom: 0.85rem;">
        <h3>${escapeHtml(item.investmentCode || 'Project')}</h3>
        <p>${escapeHtml(item.investorName || item.investor?.name || 'Investor')} · Ownership Society ${Number(item.societyOwnershipPct || 0)}% / Investor ${Number(item.investorOwnershipPct || 0)}%</p>
        <p class="table-subtitle">YTD monthly profits ${money(item.monthlyProfitTotal)} · Investor balance ${money(item.investorProfitBalance)}</p>
        <form class="cashier-monthly-return-form add-member-form" data-investment-id="${item._id}">
          <div class="form-row-2">
            <div class="form-group">
              <label>Monthly profit (৳)
                <input type="number" name="profitAmount" min="0.01" step="0.01" required />
              </label>
            </div>
            <div class="form-group">
              <label>Note
                <input type="text" name="notes" placeholder="Optional" />
              </label>
            </div>
          </div>
          <button type="submit" class="primary-btn">Record Monthly Return</button>
          <p class="message cashier-monthly-return-msg"></p>
        </form>
      </article>
    `).join('');

    list.querySelectorAll('.cashier-monthly-return-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const msg = form.querySelector('.cashier-monthly-return-msg');
        const formData = new FormData(form);
        if (msg) msg.textContent = '';
        try {
          const res = await fetch(`/api/admin/investments/${form.dataset.investmentId}/monthly-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              profitAmount: formData.get('profitAmount'),
              notes: formData.get('notes'),
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to record monthly return.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = payload.message || 'Monthly return recorded.';
          }
          if (messageEl) {
            messageEl.classList.add('success');
            messageEl.textContent = payload.message || 'Monthly return recorded.';
          }
          form.reset();
          await loadCashierMonthlyProjects();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadCashierExitQueue() {
  const list = document.getElementById('cashierExitQueueList');
  const messageEl = document.getElementById('cashierExitQueueMessage');
  if (!list) return;
  if (staffSessionUser && staffSessionUser.role !== 'cashier') {
    list.innerHTML = '<p class="text-secondary">Member-exit payouts are Cashier-only.</p>';
    return;
  }

  try {
    const response = await fetch('/api/admin/member-exits/cashier-queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load exit payout queue.');
    const queue = data.queue || [];
    if (!queue.length) {
      list.innerHTML = '<p class="text-secondary">No approved member exits awaiting payout.</p>';
      return;
    }

    list.innerHTML = queue.map((item) => {
      const member = item.departingMember || {};
      const tracking = item.approvalTracking || {};
      const breakdown = item.settlementBreakdown || {};
      return `
        <article class="feature-card payout-queue-card" style="margin-bottom: 0.85rem;">
          <h3>Exit · ${escapeHtml(item.departingMemberName || member.name || 'Member')}</h3>
          <p>Settlement <strong>${money(item.settlementAmount)}</strong></p>
          <p class="table-subtitle">Savings ${money(breakdown.savings)} · Profit ${money(breakdown.profit)} · Advance ${money(breakdown.advance)}</p>
          <p>Member approvals ${tracking.approvedCount || 0}/${tracking.totalMembers || 0} · Departing approved</p>
          <p>Email: ${escapeHtml(member.email || item.departingMemberEmail || '—')}</p>
          <form class="cashier-exit-complete-form add-member-form" data-exit-id="${item._id}">
            <div class="form-row-2">
              <div class="form-group">
                <label>Payment method
                  <select name="paymentMethod" required>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="mobile_banking">Mobile Banking</option>
                    <option value="check">Check</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
              <div class="form-group">
                <label>Transfer reference
                  <input type="text" name="transferReference" placeholder="Txn / receipt #" />
                </label>
              </div>
            </div>
            <div class="form-group">
              <label>Note
                <input type="text" name="cashierNote" placeholder="Optional note" />
              </label>
            </div>
            <button type="submit" class="primary-btn">Pay Exit &amp; Redistribute Shares</button>
            <p class="message cashier-exit-complete-msg"></p>
          </form>
        </article>
      `;
    }).join('');

    list.querySelectorAll('.cashier-exit-complete-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!window.confirm('Complete exit payout? This pays the member from the bank ledger, boosts remaining members’ balances per the plan, and soft-deletes the departing account.')) {
          return;
        }
        const msg = form.querySelector('.cashier-exit-complete-msg');
        const formData = new FormData(form);
        if (msg) msg.textContent = '';
        try {
          const res = await fetch(`/api/admin/member-exits/${form.dataset.exitId}/cashier-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentMethod: formData.get('paymentMethod'),
              transferReference: formData.get('transferReference'),
              cashierNote: formData.get('cashierNote'),
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to complete exit payout.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = payload.message || 'Exit payout completed.';
          }
          if (messageEl) {
            messageEl.classList.add('success');
            messageEl.textContent = payload.message || 'Exit payout completed.';
          }
          await loadCashierExitQueue();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadDepositsModule(options = {}) {
  const tbody = document.getElementById('cashierDepositsBody');
  const duesBody = document.getElementById('cashierMonthlyDuesBody');
  const targetBox = document.getElementById('cashierMonthTargetBox');
  const hint = document.getElementById('cashierDepositHint');
  const amountInput = document.getElementById('cashierDepositAmount');
  const msg = document.getElementById('cashierDepositMessage');
  try {
    const fetches = [
      fetch('/api/admin/deposits'),
      fetch('/api/admin/monthly-targets/active'),
      fetch('/api/admin/monthly-targets/unpaid?includePaid=1'),
    ];
    if (!options.skipLedgerFetch) {
      fetches.push(fetch('/api/admin/bank-ledger'));
    }

    const [, responses] = await Promise.all([
      ensureMembersOptions(['cashierDepositMember', 'cashierAdvanceMember']),
      Promise.all(fetches),
    ]);
    const depRes = responses[0];
    const targetRes = responses[1];
    const duesRes = responses[2];
    const ledgerRes = responses[3];

    const data = await depRes.json();
    const targetData = await targetRes.json();
    const duesData = await duesRes.json();
    const ledgerData = ledgerRes ? await ledgerRes.json() : null;

    if (!depRes.ok) throw new Error(data.error || 'Unable to load deposits.');
    if (!targetRes.ok) throw new Error(targetData.error || 'Unable to load month target.');
    if (!duesRes.ok) throw new Error(duesData.error || 'Unable to load monthly dues.');
    if (ledgerRes && ledgerRes.ok && ledgerData) {
      applyLiveBookBalance(ledgerData.bookBalance);
    }

    const target = targetData.target || {};
    depositMonthTargetCache = target.amount != null
      ? { yearMonth: target.yearMonth, amount: Number(target.amount), monthLabel: target.monthLabel || target.yearMonth }
      : null;
    depositUnpaidDuesCache = duesData.dues || [];
    bindDepositSplitPreview();

    if (targetBox) {
      if (target.amount != null) {
        targetBox.innerHTML = `
          <p><strong>${escapeHtml(target.monthLabel || target.yearMonth)} target: ${money(target.amount)}</strong></p>
          <p class="text-secondary">Source: ${escapeHtml(target.source || '—')}. Surplus above this amount → Advance; shortfall → unpaid dues.</p>
          <form id="cashierMonthTargetForm" class="add-member-form u-mt-1">
            <div class="form-row-2">
              <div class="form-group">
                <label>Set / update month
                  <input type="month" name="yearMonth" value="${escapeHtml(target.yearMonth || '')}" required />
                </label>
              </div>
              <div class="form-group">
                <label>Fixed amount
                  <input type="number" name="amount" min="0" step="0.01" value="${Number(target.amount).toFixed(2)}" required />
                </label>
              </div>
            </div>
            <button type="submit" class="secondary-btn">Save month target</button>
            <p id="cashierMonthTargetMessage" class="message"></p>
          </form>
        `;
      } else {
        targetBox.innerHTML = `
          <p class="text-secondary">No fixed target for this month. Set one so deposits can split surplus / dues.</p>
          <form id="cashierMonthTargetForm" class="add-member-form u-mt-1">
            <div class="form-row-2">
              <div class="form-group">
                <label>Month<input type="month" name="yearMonth" required /></label>
              </div>
              <div class="form-group">
                <label>Fixed amount<input type="number" name="amount" min="0" step="0.01" required /></label>
              </div>
            </div>
            <button type="submit" class="secondary-btn">Save month target</button>
            <p id="cashierMonthTargetMessage" class="message"></p>
          </form>
        `;
        const monthInput = targetBox.querySelector('[name="yearMonth"]');
        if (monthInput && !monthInput.value) {
          const now = new Date();
          monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
      }

      document.getElementById('cashierMonthTargetForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const tmsg = document.getElementById('cashierMonthTargetMessage');
        const fd = new FormData(event.target);
        const yearMonth = String(fd.get('yearMonth') || '');
        try {
          const res = await fetch(`/api/admin/monthly-targets/${encodeURIComponent(yearMonth)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: fd.get('amount') }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to save target.');
          if (tmsg) {
            tmsg.classList.add('success');
            tmsg.textContent = payload.message || 'Target saved.';
          }
          await loadDepositsModule();
        } catch (error) {
          if (tmsg) {
            tmsg.classList.remove('success');
            tmsg.textContent = error.message;
          }
        }
      });
    }

    if (hint) {
      hint.textContent = target.amount != null
        ? `This month’s fixed target is ${money(target.amount)}. Amount up to the member’s remaining due → fixed deposit; any surplus automatically → Advance balance.`
        : 'No month target set — full amount credits savings until a target is configured.';
    }
    if (amountInput && target.amount != null && !amountInput.value) {
      amountInput.value = Number(target.amount).toFixed(2);
    }
    updateDepositSplitPreview();

    const dues = (duesData.dues || []).filter((d) => Number(d.unpaidAmount || 0) > 0);
    if (duesBody) {
      duesBody.innerHTML = dues.length
        ? dues.map((d) => `
          <tr>
            <td>${escapeHtml(d.memberName || d.member?.name || '—')}</td>
            <td>${escapeHtml(d.yearMonth)}</td>
            <td>${money(d.expectedAmount)}</td>
            <td>${money(d.paidAmount)}</td>
            <td>${money(d.unpaidAmount)}</td>
            <td>${escapeHtml(d.status)}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="6">No unpaid monthly dues.</td></tr>';
    }

    const deposits = (data.deposits || []).slice(0, 40);
    if (tbody) {
      tbody.innerHTML = deposits.length
        ? deposits.map((d) => `
          <tr>
            <td>${escapeHtml(new Date(d.createdAt).toLocaleString())}</td>
            <td>${escapeHtml(d.member?.name || '—')}</td>
            <td>${money(d.amount)}${d.type && d.type !== 'regular' ? ` <span class="text-secondary">(${escapeHtml(d.type)})</span>` : ''}</td>
            <td>${escapeHtml(paymentChannelLabel(d.paymentMethod))}</td>
            <td><code>${escapeHtml(d.receiptNumber || '—')}</code></td>
            <td><a href="/api/admin/deposits/${d._id}/receipt" target="_blank" rel="noopener">PDF</a></td>
          </tr>
        `).join('')
        : '<tr><td colspan="6">No deposits yet.</td></tr>';
    }
  } catch (error) {
    if (msg) msg.textContent = error.message;
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
    if (duesBody) duesBody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

let depositMonthTargetCache = null;
let depositUnpaidDuesCache = [];
let depositSplitPreviewBound = false;

function getMemberRemainingMonthlyDue(memberId) {
  if (!depositMonthTargetCache) return null;
  if (!memberId) return Number(depositMonthTargetCache.amount || 0);
  const due = depositUnpaidDuesCache.find((row) => String(row.memberId || row.member?._id || row.member) === String(memberId));
  if (due) return Math.max(0, Number(due.unpaidAmount || 0));
  // No due row yet for this member — treat remaining as the full month target.
  return Number(depositMonthTargetCache.amount || 0);
}

function computeClientDepositSplit(totalAmount, remainingDue, targetAmount) {
  const total = Math.max(0, Number(totalAmount || 0));
  if (!(total > 0)) {
    return { towardTarget: 0, surplus: 0, remainingUnpaid: Math.max(0, Number(remainingDue || 0)) };
  }
  if (targetAmount == null || targetAmount === '') {
    return { towardTarget: total, surplus: 0, remainingUnpaid: 0 };
  }
  const remaining = Math.max(0, Number(remainingDue || 0));
  const towardTarget = Math.min(total, remaining);
  const surplus = Math.max(0, total - towardTarget);
  return {
    towardTarget: Number(towardTarget.toFixed(2)),
    surplus: Number(surplus.toFixed(2)),
    remainingUnpaid: Number(Math.max(0, remaining - towardTarget).toFixed(2)),
  };
}

function updateDepositSplitPreview() {
  const preview = document.getElementById('cashierDepositSplitPreview');
  const previewText = document.getElementById('cashierDepositSplitPreviewText');
  const memberSelect = document.getElementById('cashierDepositMember');
  const amountInput = document.getElementById('cashierDepositAmount');
  if (!preview || !previewText) return;

  const amount = Number(amountInput?.value || 0);
  if (!depositMonthTargetCache || !(amount > 0)) {
    preview.hidden = true;
    previewText.textContent = '';
    return;
  }

  const memberId = memberSelect?.value || '';
  const remaining = getMemberRemainingMonthlyDue(memberId);
  const split = computeClientDepositSplit(amount, remaining, depositMonthTargetCache.amount);
  const monthLabel = depositMonthTargetCache.monthLabel || depositMonthTargetCache.yearMonth;

  if (split.surplus > 0 && split.towardTarget > 0) {
    previewText.textContent = `Will record ${money(split.towardTarget)} as fixed ${monthLabel} deposit + ${money(split.surplus)} → Advance balance.`;
  } else if (split.surplus > 0) {
    previewText.textContent = `Month target already covered — full ${money(split.surplus)} → Advance balance.`;
  } else if (split.remainingUnpaid > 0) {
    previewText.textContent = `Will record ${money(split.towardTarget)} toward fixed ${monthLabel} deposit · still due after this: ${money(split.remainingUnpaid)}.`;
  } else {
    previewText.textContent = `Will record ${money(split.towardTarget)} as fixed ${monthLabel} deposit (target covered).`;
  }
  preview.hidden = false;
}

function bindDepositSplitPreview() {
  if (depositSplitPreviewBound) {
    updateDepositSplitPreview();
    return;
  }
  depositSplitPreviewBound = true;
  const memberSelect = document.getElementById('cashierDepositMember');
  const amountInput = document.getElementById('cashierDepositAmount');

  memberSelect?.addEventListener('change', () => {
    const remaining = getMemberRemainingMonthlyDue(memberSelect.value);
    if (amountInput && remaining != null && remaining > 0) {
      amountInput.value = Number(remaining).toFixed(2);
    }
    updateDepositSplitPreview();
  });
  amountInput?.addEventListener('input', updateDepositSplitPreview);
  amountInput?.addEventListener('change', updateDepositSplitPreview);
  updateDepositSplitPreview();
}

let unpaidContributionsCache = [];

function contributionDueAmount(contribution) {
  if (!contribution) return 0;
  if (contribution.unpaidAmount != null && contribution.unpaidAmount !== '') {
    return Number(contribution.unpaidAmount || 0);
  }
  const expected = Number(contribution.expectedAmount || 0);
  const covered = Number(contribution.paidFromSavings || 0)
    + Number(contribution.paidFromAdvance || 0)
    + Number(contribution.borrowedAmount || 0);
  return Math.max(0, Number((expected - covered).toFixed(2)));
}

function populateBorrowLenderSelect(members = []) {
  const lenderSelect = document.getElementById('cashierBorrowLender');
  if (!lenderSelect) return;
  const previous = lenderSelect.value;
  const withAdvance = (members || []).filter((m) => Number(m.advanceBalance) > 0);
  lenderSelect.disabled = false;
  if (!withAdvance.length) {
    lenderSelect.innerHTML = '<option value="">No members with advance balance</option>';
    return;
  }
  lenderSelect.innerHTML = `<option value="">Select lender…</option>${withAdvance.map((m) => `
    <option value="${m.id}">${escapeHtml(m.name)} (advance ${money(m.advanceBalance)})</option>
  `).join('')}`;
  if (previous && withAdvance.some((m) => String(m.id) === String(previous))) {
    lenderSelect.value = previous;
  }
}

async function loadFundingModule() {
  const advanceBody = document.getElementById('cashierAdvanceBody');
  const unpaidBody = document.getElementById('cashierUnpaidBody');
  const borrowingsBody = document.getElementById('cashierBorrowingsBody');
  const contribSelect = document.getElementById('cashierBorrowContribution');
  const lenderSelect = document.getElementById('cashierBorrowLender');

  try {
    const [, advRes, unpaidRes, borrowRes] = await Promise.all([
      ensureMembersOptions(['cashierAdvanceMember']),
      fetch('/api/admin/funding/advances'),
      fetch('/api/admin/funding/unpaid-contributions'),
      fetch('/api/admin/funding/borrowings?status=open'),
    ]);
    const advances = await advRes.json();
    const unpaid = await unpaidRes.json();
    const borrowings = await borrowRes.json();

    if (!advRes.ok) throw new Error(advances.error || 'Unable to load advances.');
    if (!unpaidRes.ok) throw new Error(unpaid.error || 'Unable to load unpaid shares.');
    if (!borrowRes.ok) throw new Error(borrowings.error || 'Unable to load borrowings.');

    const members = advances.members || [];
    if (advanceBody) {
      advanceBody.innerHTML = members.length
        ? members.map((m) => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${money(m.savings)}</td>
            <td>${money(m.advanceBalance)}</td>
            <td>${money(m.profit)}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="4">No members.</td></tr>';
    }

    populateBorrowLenderSelect(members);
    if (lenderSelect) lenderSelect.disabled = false;

    unpaidContributionsCache = unpaid.contributions || [];
    if (unpaidBody) {
      unpaidBody.innerHTML = unpaidContributionsCache.length
        ? unpaidContributionsCache.map((c) => {
          const due = contributionDueAmount(c);
          const canDirectRepay = due > 0;
          const borrowId = c.borrowing?._id || c.borrowing;
          return `
          <tr>
            <td>${escapeHtml(c.investment?.investmentCode || '—')}</td>
            <td>${escapeHtml(c.memberName || c.member?.name || '—')}</td>
            <td>${money(due || c.borrowedAmount)}</td>
            <td>${escapeHtml(c.status)}</td>
            <td>
              ${canDirectRepay ? `
                <button type="button" class="secondary-btn" data-repay-contribution="${c._id}">Record repayment</button>
              ` : ''}
              ${canDirectRepay ? `
                <button type="button" class="primary-btn" data-cover-reserve="${c._id}" data-due="${due}">Cover from reserve</button>
              ` : ''}
              ${borrowId ? `
                <button type="button" class="secondary-btn" data-repay-borrowing="${borrowId}">Settle borrow</button>
              ` : (!canDirectRepay ? '—' : '')}
            </td>
          </tr>
        `;
        }).join('')
        : '<tr><td colspan="5">No unpaid shares.</td></tr>';
    }

    if (contribSelect) {
      // Flexible: any share with remaining unpaid due, even after partial/past payments or prior borrows.
      const borrowable = unpaidContributionsCache.filter((c) => contributionDueAmount(c) > 0);
      const previous = contribSelect.value;
      contribSelect.innerHTML = `<option value="">Select unpaid share…</option>${borrowable.map((c) => {
        const due = contributionDueAmount(c);
        const historyParts = [];
        if (Number(c.paidFromSavings) > 0) historyParts.push(`savings ${money(c.paidFromSavings)}`);
        if (Number(c.paidFromAdvance) > 0) historyParts.push(`advance ${money(c.paidFromAdvance)}`);
        if (Number(c.borrowedAmount) > 0) historyParts.push(`borrowed ${money(c.borrowedAmount)}`);
        const history = historyParts.length ? ` · paid ${historyParts.join(', ')}` : '';
        return `
        <option value="${c._id}"
          data-amount="${due}"
          data-investment="${c.investment?._id || c.investment || ''}"
          data-borrower="${c.member?._id || c.member || ''}"
          data-contribution="${c._id}">
          ${escapeHtml(c.memberName || c.member?.name || 'Member')} · ${escapeHtml(c.investment?.investmentCode || '')} · due ${money(due)}${escapeHtml(history)}
        </option>`;
      }).join('')}`;
      if (previous && borrowable.some((c) => String(c._id) === String(previous))) {
        contribSelect.value = previous;
      }
      contribSelect.onchange = () => {
        const opt = contribSelect.selectedOptions[0];
        const amountInput = document.getElementById('cashierBorrowAmount');
        if (opt && amountInput) amountInput.value = opt.dataset.amount || '';
      };
      if (contribSelect.value) contribSelect.onchange();
    }

    const openBorrowings = borrowings.borrowings || [];

    if (borrowingsBody) {
      borrowingsBody.innerHTML = openBorrowings.length
        ? openBorrowings.map((b) => {
          const outstanding = Math.max(0, Number(b.amount || 0) - Number(b.amountSettled || 0));
          const lenderName = b.lenderName || b.lender?.name || 'lender';
          const borrowerName = b.borrowerName || b.borrower?.name || '—';
          const projectLabel = b.investment?.investmentCode || b.note || '—';
          const borrowingId = String(b._id || b.id || '');
          return `
            <tr data-borrowing-row="${escapeHtml(borrowingId)}">
              <td>${escapeHtml(projectLabel)}</td>
              <td>${escapeHtml(borrowerName)}</td>
              <td>${escapeHtml(lenderName)}</td>
              <td>${money(b.amount)}</td>
              <td>${money(outstanding)}</td>
              <td>${escapeHtml(new Date(b.createdAt).toLocaleString())}</td>
              <td>
                <button type="button" class="primary-btn"
                  data-settle-borrowing="${escapeHtml(borrowingId)}"
                  data-outstanding="${outstanding}"
                  data-lender-name="${escapeHtml(lenderName)}"
                  data-borrower-name="${escapeHtml(borrowerName)}"
                  ${!borrowingId || outstanding <= 0 ? 'disabled' : ''}>
                  Settle &amp; refund lender
                </button>
              </td>
            </tr>
          `;
        }).join('')
        : '<tr><td colspan="7">No open borrowings.</td></tr>';
    }

    document.querySelectorAll('[data-repay-contribution]').forEach((btn) => {
      btn.onclick = async () => {
        const msg = document.getElementById('cashierUnpaidMessage');
        const amountHint = btn.dataset.due ? ` (${money(btn.dataset.due)})` : '';
        if (!window.confirm(`Record repayment for this unpaid share${amountHint}? Credits bank ledger and marks settled.`)) return;
        try {
          const res = await fetch(`/api/admin/funding/unpaid-contributions/${btn.dataset.repayContribution}/repay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Unable to repay.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = 'Contribution repayment recorded. Bank ledger credited.';
          }
          invalidateStaffViewCache(['funding']);
          await loadFundingModule();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      };
    });

    document.querySelectorAll('[data-cover-reserve]').forEach((btn) => {
      btn.onclick = async () => {
        const msg = document.getElementById('cashierUnpaidMessage');
        const due = Number(btn.dataset.due || 0);
        if (!window.confirm(`Cover ${money(due)} from the Emergency / Reserve Fund for this unpaid project share?`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/admin/emergency-reserve/cover-contribution/${btn.dataset.coverReserve}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: due || undefined }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Unable to cover from reserve.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = data.message || 'Covered from Emergency / Reserve Fund.';
          }
          invalidateStaffViewCache(['funding', 'reserve', 'queue']);
          await loadFundingModule();
        } catch (error) {
          btn.disabled = false;
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      };
    });

    // Settle buttons use delegated handler bound once in bindFundingSettleActions().
  } catch (error) {
    if (advanceBody) advanceBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    const settleMsg = document.getElementById('cashierSettleMessage');
    if (settleMsg) {
      settleMsg.classList.remove('success');
      settleMsg.textContent = error.message;
    }
  }
}

async function settleBorrowingRepayment(button) {
  const id = String(button?.dataset?.settleBorrowing || button?.dataset?.repayBorrowing || '').trim();
  if (!id) {
    throw new Error('Borrowing id is missing. Refresh the page and try again.');
  }

  const lenderName = button.dataset.lenderName || 'the original lender';
  const borrowerName = button.dataset.borrowerName || 'the borrower';
  const outstanding = Number(button.dataset.outstanding || 0);
  const msg = document.getElementById('cashierSettleMessage') || document.getElementById('cashierUnpaidMessage');

  if (msg) {
    msg.classList.remove('success', 'error');
    msg.textContent = `Settling repayment${outstanding > 0 ? ` of ${money(outstanding)}` : ''}…`;
  }

  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/funding/borrowings/${encodeURIComponent(id)}/repay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: outstanding > 0 ? outstanding : undefined,
        notes: `Settled by cashier — refund to ${lenderName}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to settle borrowing.');

    const refunded = data.lender?.refundedAmount ?? data.settledAmount;
    const deducted = data.borrower?.deductedAmount ?? data.settledAmount;
    const lenderLabel = data.lender?.name || lenderName;
    const borrowerLabel = data.borrower?.name || borrowerName;
    const successText = data.fullySettled
      ? `Settled ${money(data.settledAmount)}. Deducted ${money(deducted)} from ${borrowerLabel}'s savings, credited the bank ledger, and refunded ${money(refunded)} to ${lenderLabel}'s advance (now ${money(data.lender?.advanceBalance)}).`
      : `Partial settlement ${money(data.settledAmount)}. Deducted ${money(deducted)} from ${borrowerLabel}, refunded ${money(refunded)} to ${lenderLabel}. Outstanding ${money(data.outstandingAfter)}.`;

    if (msg) {
      msg.classList.remove('error');
      msg.classList.add('success');
      msg.textContent = successText;
    }

    // Remove the row immediately for responsive UI, then reload module data.
    const row = button.closest('[data-borrowing-row]');
    if (data.fullySettled && row) {
      row.remove();
      const body = document.getElementById('cashierBorrowingsBody');
      if (body && !body.querySelector('[data-borrowing-row]')) {
        body.innerHTML = '<tr><td colspan="7">No open borrowings.</td></tr>';
      }
    }

    invalidateStaffViewCache(['funding', 'ledger', 'deposits', 'home']);
    await loadFundingModule();
    return data;
  } catch (error) {
    button.disabled = false;
    if (msg) {
      msg.classList.remove('success');
      msg.classList.add('error');
      msg.textContent = error.message || String(error);
    } else {
      window.alert(error.message || String(error));
    }
    throw error;
  }
}

function bindFundingSettleActions() {
  const root = document.getElementById('moduleFunding') || document.getElementById('cashierBorrowingsBody');
  if (!root || root.dataset.settleBound === '1') return;
  root.dataset.settleBound = '1';

  root.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-settle-borrowing], [data-repay-borrowing]');
    if (!btn || btn.disabled) return;
    event.preventDefault();
    try {
      await settleBorrowingRepayment(btn);
    } catch (_) {
      // Error already shown in settleBorrowingRepayment
    }
  });
}

window.settleBorrowingRepayment = settleBorrowingRepayment;

async function loadEmergencyReserveModule() {
  const sharesBody = document.getElementById('cashierReserveSharesBody');
  const entriesBody = document.getElementById('cashierReserveEntriesBody');
  const balanceEl = document.getElementById('reserveFundBalance');
  const bookEl = document.getElementById('reserveBookBalance');
  const countEl = document.getElementById('reserveMemberCount');

  try {
    const response = await fetch('/api/admin/emergency-reserve');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load emergency reserve fund.');

    if (balanceEl) balanceEl.textContent = money(data.balance);
    if (bookEl) bookEl.textContent = data.bookBalance == null ? '—' : money(data.bookBalance);
    if (countEl) countEl.textContent = String(data.memberCount || (data.memberShares || []).length || 0);
    applyLiveBookBalance(data.bookBalance);

    const shares = data.memberShares || [];
    if (sharesBody) {
      sharesBody.innerHTML = shares.length
        ? shares.map((row) => `
          <tr>
            <td>${escapeHtml(row.name || 'Member')}</td>
            <td>${money(row.weight)}</td>
            <td><strong>${money(row.shareAmount)}</strong></td>
          </tr>
        `).join('')
        : '<tr><td colspan="3">No active members.</td></tr>';
    }

    const entries = data.entries || [];
    if (entriesBody) {
      entriesBody.innerHTML = entries.length
        ? entries.map((entry) => `
          <tr>
            <td>${escapeHtml(new Date(entry.createdAt).toLocaleString())}</td>
            <td>${escapeHtml(entry.type)}</td>
            <td>${escapeHtml(entry.direction)}</td>
            <td>${money(entry.amount)}</td>
            <td>${money(entry.balanceAfter)}</td>
            <td>${escapeHtml(entry.note || '—')}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="6">No reserve activity yet.</td></tr>';
    }
  } catch (error) {
    if (sharesBody) sharesBody.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message)}</td></tr>`;
    if (entriesBody) entriesBody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

let reserveAllocateBound = false;
function bindEmergencyReserveForms() {
  if (reserveAllocateBound) return;
  reserveAllocateBound = true;
  document.getElementById('cashierReserveAllocateForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierReserveAllocateMessage');
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/admin/emergency-reserve/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: formData.get('amount'),
          note: formData.get('note') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to allocate to reserve fund.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message || 'Allocated to Emergency / Reserve Fund.';
      }
      event.target.reset();
      invalidateStaffViewCache(['reserve', 'ledger', 'home']);
      await loadEmergencyReserveModule();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });
}

async function loadWithdrawalsModule() {
  const tbody = document.getElementById('cashierWithdrawalsBody');
  const msg = document.getElementById('cashierWithdrawalsMessage');
  try {
    const response = await fetch('/api/withdrawals/admin');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load withdrawals.');
    const requests = data.requests || [];
    if (!tbody) return;
    if (!requests.length) {
      tbody.innerHTML = '<tr><td colspan="5">No withdrawal requests.</td></tr>';
      return;
    }
    tbody.innerHTML = requests.map((request) => `
      <tr>
        <td>${escapeHtml(request.member?.name || 'Unknown')}</td>
        <td>${money(request.amount)}</td>
        <td>${escapeHtml(request.status)}</td>
        <td>${escapeHtml(request.reason || '—')}</td>
        <td>
          ${request.status === 'pending' ? `
            <button type="button" class="secondary-btn" data-withdrawal-status="approved" data-id="${request._id}">Approve</button>
            <button type="button" class="ghost-btn" data-withdrawal-status="rejected" data-id="${request._id}">Reject</button>
          ` : request.status === 'approved' ? `
            <div class="withdrawal-process-row">
              <select class="withdrawal-payment-method" data-id="${request._id}">
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="mfs">MFS</option>
              </select>
              <input type="text" class="withdrawal-payment-ref" data-id="${request._id}" placeholder="Txn ref" />
              <button type="button" class="primary-btn" data-withdrawal-status="processed" data-id="${request._id}">Process</button>
            </div>
          ` : request.paymentMethod ? `${escapeHtml(paymentChannelLabel(request.paymentMethod))}${request.disbursementReference ? ` · ${escapeHtml(request.disbursementReference)}` : ''}` : '—'}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-withdrawal-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (msg) msg.textContent = '';
        const requestId = btn.dataset.id;
        const status = btn.dataset.withdrawalStatus;
        const paymentMethod = tbody.querySelector(`.withdrawal-payment-method[data-id="${requestId}"]`)?.value || 'cash';
        const disbursementReference = tbody.querySelector(`.withdrawal-payment-ref[data-id="${requestId}"]`)?.value || '';
        try {
          const res = await fetch(`/api/withdrawals/admin/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status,
              paymentMethod: status === 'processed' ? paymentMethod : undefined,
              disbursementReference: status === 'processed' ? disbursementReference : undefined,
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to update withdrawal.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = `Withdrawal marked ${btn.dataset.withdrawalStatus}.`;
          }
          await loadWithdrawalsModule();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    if (msg) msg.textContent = error.message;
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadRefundsModule() {
  try {
    await ensureMembersOptions(['cashierRefundMember']);
  } catch (error) {
    const msg = document.getElementById('cashierRefundMessage');
    if (msg) msg.textContent = error.message;
  }
}

async function loadReportsModule() {
  const grid = document.getElementById('cashierReportStats');
  const msg = document.getElementById('cashierReportsMessage');
  try {
    const response = await fetch('/api/admin/summary');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load summary.');
    if (grid) {
      grid.innerHTML = `
        <div class="stat-card"><h3>${data.activeMembers ?? data.totalMembers ?? 0}</h3><p>Active members</p></div>
        <div class="stat-card"><h3>${money(data.totalSavings)}</h3><p>Total savings</p></div>
        <div class="stat-card"><h3>${money(data.totalProfit)}</h3><p>Total profit</p></div>
        <div class="stat-card"><h3>${data.totalDeposits ?? 0}</h3><p>Deposit records</p></div>
      `;
    }
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
}

function renderAuditSummary(summary = {}) {
  const grid = document.getElementById('auditSummaryStats');
  if (!grid) return;
  grid.innerHTML = `
    <div class="stat-card"><h3>${money(summary.totalIn)}</h3><p>Total in</p></div>
    <div class="stat-card"><h3>${money(summary.totalOut)}</h3><p>Total out</p></div>
    <div class="stat-card"><h3>${money(summary.net)}</h3><p>Net flow</p></div>
    <div class="stat-card"><h3>${summary.count ?? 0}</h3><p>Transactions</p></div>
  `;
}

function renderAuditRows(transactions = [], { append = false } = {}) {
  const tbody = document.getElementById('auditTransactionsBody');
  if (!tbody) return;
  const rows = transactions.map((tx) => `
    <tr>
      <td>${escapeHtml(tx.occurredAt ? new Date(tx.occurredAt).toLocaleString() : '—')}</td>
      <td>${escapeHtml(tx.categoryLabel || tx.category || '—')}</td>
      <td><span class="${auditDirectionClass(tx.direction)}">${escapeHtml(tx.direction === 'in' ? 'In' : 'Out')}</span></td>
      <td>${money(tx.amount)}</td>
      <td>${escapeHtml(tx.description || '—')}</td>
      <td>${escapeHtml(tx.actor || '—')}</td>
      <td>${tx.balanceAfter != null ? money(tx.balanceAfter) : '—'}</td>
    </tr>
  `).join('');

  if (append) {
    tbody.insertAdjacentHTML('beforeend', rows);
  } else {
    tbody.innerHTML = rows || '<tr><td colspan="7">No transactions matched the selected filters.</td></tr>';
  }
}

async function ensureAuditCategories() {
  const select = document.getElementById('auditCategory');
  if (!select || select.dataset.loaded === '1') return;
  const response = await fetch('/api/admin/transaction-audit/categories');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load audit categories.');
  select.innerHTML = (data.categories || []).map((item) => (
    `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`
  )).join('');
  select.dataset.loaded = '1';
}

async function fetchAuditTrail({ append = false } = {}) {
  const msg = document.getElementById('auditMessage');
  const loadMoreBtn = document.getElementById('auditLoadMoreBtn');
  const query = buildQueryString({
    ...auditState.filters,
    limit: 100,
    offset: append ? auditState.offset : 0,
  });

  const response = await fetch(`/api/admin/transaction-audit${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load audit trail.');

  auditState.offset = append ? auditState.offset + (data.transactions || []).length : (data.transactions || []).length;
  auditState.hasMore = Boolean(data.hasMore);
  renderAuditSummary(data.summary || {});
  renderAuditRows(data.transactions || [], { append });
  if (loadMoreBtn) loadMoreBtn.hidden = !auditState.hasMore;
  if (msg) msg.textContent = `${data.totalMatched ?? 0} transaction(s) matched.`;
}

async function loadStaffCashierTracking() {
  const root = document.getElementById('staffCashierTrackingRoot');
  if (!root || !window.SocietyCashierTracking) return;
  await window.SocietyCashierTracking.mount(root);
}

function applyLedgerAdminVisibility(canManage) {
  const adminOnly = document.querySelectorAll('.ledger-admin-only');
  adminOnly.forEach((el) => {
    el.classList.toggle('hidden', !canManage);
  });
  document.getElementById('auditExportPdfBtn')?.classList.toggle('hidden', !canManage);
  document.getElementById('zReportBtn')?.classList.toggle('hidden', !canManage);
  document.getElementById('cashierZReportBtn')?.classList.toggle('hidden', !canManage);
}

async function loadAuditModule() {
  const tbody = document.getElementById('auditTransactionsBody');
  if (tbody && !tbody.dataset.loading) {
    tbody.innerHTML = '<tr><td colspan="7">Loading audit trail…</td></tr>';
  }
  try {
    await ensureAuditCategories();
    if (!auditState.filters.category) {
      auditState.filters = {
        from: document.getElementById('auditFromDate')?.value || '',
        to: document.getElementById('auditToDate')?.value || '',
        category: document.getElementById('auditCategory')?.value || 'all',
      };
    }
    auditState.offset = 0;
    await fetchAuditTrail({ append: false });
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

function bindAuditForms() {
  const form = document.getElementById('auditFilterForm');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    auditState.filters = {
      from: formData.get('from') || '',
      to: formData.get('to') || '',
      category: formData.get('category') || 'all',
    };
    auditState.offset = 0;
    const applyBtn = document.getElementById('auditApplyBtn');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Loading…';
    }
    try {
      await fetchAuditTrail({ append: false });
    } catch (error) {
      const msg = document.getElementById('auditMessage');
      if (msg) msg.textContent = error.message;
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply filters';
      }
    }
  });

  document.getElementById('auditClearBtn')?.addEventListener('click', () => {
    form.reset();
    auditState.filters = { from: '', to: '', category: 'all' };
    auditState.offset = 0;
    void loadAuditModule();
  });

  document.getElementById('auditLoadMoreBtn')?.addEventListener('click', () => {
    void fetchAuditTrail({ append: true }).catch((error) => {
      const msg = document.getElementById('auditMessage');
      if (msg) msg.textContent = error.message;
    });
  });

  document.getElementById('auditExportPdfBtn')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const query = buildQueryString({
      ...auditState.filters,
      limit: 500,
      offset: 0,
    });
    triggerPdfDownload(button, `/api/admin/transaction-audit/export.pdf${query}`);
  });
}

function bindDirectoryTabs() {
  const membersTab = document.getElementById('cashierMembersTab');
  const investorsTab = document.getElementById('cashierInvestorsTab');
  const membersDir = document.getElementById('cashierMembersDirectory');
  const investorsDir = document.getElementById('cashierInvestorsDirectory');
  if (!membersTab || membersTab.dataset.bound === '1') return;
  membersTab.dataset.bound = '1';

  const activate = (tab) => {
    const isMembers = tab === 'members';
    membersTab.classList.toggle('active', isMembers);
    investorsTab?.classList.toggle('active', !isMembers);
    membersDir?.classList.toggle('hidden', !isMembers);
    investorsDir?.classList.toggle('hidden', isMembers);
    if (!isMembers) void loadInvestorsModule();
  };

  membersTab.addEventListener('click', () => activate('members'));
  investorsTab?.addEventListener('click', () => activate('investors'));
}

let cashierChatMemberId = null;
let cashierChatMemberName = '';
let cashierChatReplyTo = null;
let cashierChatDirectory = [];
let cashierChatPollTimer = null;

function stopCashierChatPolling() {
  if (cashierChatPollTimer) {
    clearInterval(cashierChatPollTimer);
    cashierChatPollTimer = null;
  }
}

function setCashierReplyTarget(target = null) {
  cashierChatReplyTo = target;
  const bar = document.getElementById('cashierChatReplyBar');
  const nameEl = document.getElementById('cashierChatReplyName');
  const previewEl = document.getElementById('cashierChatReplyPreview');
  if (!bar) return;
  if (!target) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  if (nameEl) nameEl.textContent = `Reply to ${target.name || 'message'}`;
  if (previewEl) previewEl.textContent = target.preview || '';
}

function renderCashierChatDirectory(filter = '') {
  const list = document.getElementById('cashierChatInboxList');
  if (!list) return;
  const Chat = window.SocietyChat;
  const term = String(filter || '').trim().toLowerCase();
  const rows = cashierChatDirectory.filter((row) => {
    const name = row.member?.name || '';
    const email = row.member?.email || '';
    if (!term) return true;
    return name.toLowerCase().includes(term) || email.toLowerCase().includes(term);
  });

  if (!rows.length) {
    list.innerHTML = '<p class="table-subtitle">No members found.</p>';
    return;
  }

  list.innerHTML = rows.map((row) => {
    const id = String(row.memberId);
    const name = row.member?.name || 'Member';
    const preview = Chat ? Chat.lastMessagePreview(row.lastMessage) : (row.lastMessage?.body || 'Start a conversation');
    const active = cashierChatMemberId === id ? 'active' : '';
    return `
      <button type="button" class="chat-inbox-item ${active}" data-cashier-chat-member="${escapeHtml(id)}" data-member-name="${escapeHtml(name)}">
        <div class="chat-inbox-item-head">
          <strong>${escapeHtml(name)}</strong>
          ${row.unreadCount ? `<span class="chat-unread-badge">${row.unreadCount}</span>` : ''}
        </div>
        <p class="chat-inbox-preview">${escapeHtml(preview)}</p>
      </button>
    `;
  }).join('');

  list.querySelectorAll('[data-cashier-chat-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void openCashierChat(btn.dataset.cashierChatMember, btn.dataset.memberName || 'Member');
    });
  });
}

async function refreshCashierChatThread() {
  if (!cashierChatMemberId) return;
  const thread = document.getElementById('cashierChatThread');
  const Chat = window.SocietyChat;
  if (!thread || !Chat) return;
  try {
    const response = await fetch(`/api/admin/chat/members/${cashierChatMemberId}/messages`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load messages.');
    Chat.renderChatMessages(thread, data.messages || [], 'admin', {
      onReplyClick: setCashierReplyTarget,
    });
  } catch (error) {
    thread.innerHTML = `<p class="table-subtitle chat-empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function openCashierChat(memberId, memberName = 'Member') {
  cashierChatMemberId = String(memberId);
  cashierChatMemberName = memberName;
  setCashierReplyTarget(null);

  const header = document.getElementById('cashierChatThreadHeader');
  const form = document.getElementById('cashierChatComposeForm');
  if (header) {
    header.innerHTML = `
      <h3>${escapeHtml(memberName)}</h3>
      <p class="table-subtitle">Direct messenger thread · live updates every few seconds</p>
    `;
  }
  form?.classList.remove('hidden');
  renderCashierChatDirectory(document.getElementById('cashierChatSearch')?.value || '');
  await refreshCashierChatThread();

  stopCashierChatPolling();
  const pollMs = Math.max(Number(window.SocietyChat?.POLL_MS) || 5000, 5000);
  let chatDirectoryTick = 0;
  cashierChatPollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || staffCurrentView !== 'chat') return;
    void refreshCashierChatThread();
    chatDirectoryTick += 1;
    if (chatDirectoryTick % 3 === 0) {
      void loadCashierChatDirectory(true);
    }
  }, pollMs);
}

async function loadCashierChatDirectory(silent = false) {
  const list = document.getElementById('cashierChatInboxList');
  const msg = document.getElementById('cashierChatMessage');
  try {
    const response = await fetch('/api/admin/chat/directory');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load chat directory.');
    cashierChatDirectory = data.directory || [];
    renderCashierChatDirectory(document.getElementById('cashierChatSearch')?.value || '');
  } catch (error) {
    if (!silent && msg) msg.textContent = error.message;
    if (!silent && list) list.innerHTML = `<p class="table-subtitle">${escapeHtml(error.message)}</p>`;
  }
}

async function loadChatModule() {
  await loadCashierChatDirectory();
  const search = document.getElementById('cashierChatSearch');
  const refreshBtn = document.getElementById('cashierChatRefreshBtn');
  const form = document.getElementById('cashierChatComposeForm');
  const filesInput = document.getElementById('cashierChatFiles');
  const fileLabel = document.getElementById('cashierChatFileLabel');

  if (search && search.dataset.bound !== '1') {
    search.dataset.bound = '1';
    search.addEventListener('input', () => renderCashierChatDirectory(search.value));
  }
  if (refreshBtn && refreshBtn.dataset.bound !== '1') {
    refreshBtn.dataset.bound = '1';
    refreshBtn.addEventListener('click', () => void loadCashierChatDirectory());
  }
  const clearReplyBtn = document.getElementById('cashierChatReplyClear');
  if (clearReplyBtn && clearReplyBtn.dataset.bound !== '1') {
    clearReplyBtn.dataset.bound = '1';
    clearReplyBtn.addEventListener('click', () => setCashierReplyTarget(null));
  }

  if (filesInput && filesInput.dataset.bound !== '1') {
    filesInput.dataset.bound = '1';
    filesInput.addEventListener('change', () => {
      const count = filesInput.files?.length || 0;
      if (fileLabel) fileLabel.textContent = count ? `${count} file(s) selected` : '';
    });
  }

  if (form && form.dataset.bound !== '1') {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!cashierChatMemberId) return;
      const messageEl = document.getElementById('cashierChatComposeMessage');
      const body = form.body?.value?.trim() || '';
      const Chat = window.SocietyChat;
      try {
        const files = Chat
          ? await Chat.readFilesAsPayload(filesInput?.files || [])
          : [];
        if (!body && !files.length) {
          if (messageEl) messageEl.textContent = 'Add a message or attachment.';
          return;
        }
        const response = await fetch(`/api/admin/chat/members/${cashierChatMemberId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body,
            replyTo: cashierChatReplyTo?.id || null,
            files,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to send.');
        form.reset();
        if (fileLabel) fileLabel.textContent = '';
        setCashierReplyTarget(null);
        if (messageEl) {
          messageEl.classList.add('success');
          messageEl.textContent = 'Sent.';
        }
        await refreshCashierChatThread();
        await loadCashierChatDirectory(true);
      } catch (error) {
        if (messageEl) {
          messageEl.classList.remove('success');
          messageEl.textContent = error.message;
        }
      }
    });
  }

  if (cashierChatMemberId) {
    await openCashierChat(cashierChatMemberId, cashierChatMemberName);
  }
}

async function loadInvestorsModule() {
  const tbody = document.getElementById('cashierInvestorsBody');
  try {
    const response = await fetch('/api/admin/investors');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load investors.');
    staffInvestorsCache = data.investors || [];
    if (!tbody) return;
    tbody.innerHTML = staffInvestorsCache.length
      ? staffInvestorsCache.map((investor) => {
        const id = investor._id || investor.id;
        return `
          <tr class="cashier-investor-row" data-investor-id="${escapeHtml(String(id))}" tabindex="0" role="button" title="Open investor portfolio">
            <td>${escapeHtml(investor.name)}</td>
            <td>${escapeHtml(investor.email || '—')}</td>
            <td>${escapeHtml(investor.phone || '—')}</td>
            <td>${escapeHtml(investor.status || 'active')}</td>
            <td>
              <button type="button" class="secondary-btn" data-open-investor-profile="${escapeHtml(String(id))}">
                View portfolio
              </button>
            </td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="5">No investors found.</td></tr>';

    tbody.querySelectorAll('[data-open-investor-profile]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void openCashierInvestorProfile(btn.dataset.openInvestorProfile);
      });
    });
    tbody.querySelectorAll('.cashier-investor-row').forEach((row) => {
      row.addEventListener('click', () => {
        void openCashierInvestorProfile(row.dataset.investorId);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openCashierInvestorProfile(row.dataset.investorId);
        }
      });
    });
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadMembersModule({ force = false } = {}) {
  const tbody = document.getElementById('cashierMembersBody');
  try {
    if (force) staffMembersCache = [];
    await ensureMembersOptions([]);
    if (!tbody) return;
    tbody.innerHTML = staffMembersCache.length
      ? staffMembersCache.map((m) => {
        const id = m._id || m.id;
        return `
          <tr class="cashier-member-row" data-member-id="${escapeHtml(String(id))}" tabindex="0" role="button" title="Open member portfolio">
            <td>${escapeHtml(m.name)}</td>
            <td><code>${escapeHtml(shortMemberId(id))}</code></td>
            <td>${escapeHtml(m.email || '—')}</td>
            <td>${escapeHtml(m.phone || '—')}</td>
            <td>${escapeHtml(m.status || 'active')}</td>
            <td>${money(m.savings)}</td>
            <td>
              <button type="button" class="secondary-btn" data-open-member-profile="${escapeHtml(String(id))}">
                View portfolio
              </button>
            </td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="7">No members found.</td></tr>';

    tbody.querySelectorAll('[data-open-member-profile]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        void openCashierMemberProfile(btn.dataset.openMemberProfile);
      });
    });
    tbody.querySelectorAll('.cashier-member-row').forEach((row) => {
      row.addEventListener('click', () => {
        void openCashierMemberProfile(row.dataset.memberId);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openCashierMemberProfile(row.dataset.memberId);
        }
      });
    });
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

function closeCashierMemberProfile() {
  const modal = document.getElementById('cashierMemberProfileModal');
  if (modal) modal.classList.add('hidden');
}

function statusPill(status) {
  const label = String(status || '—').replace(/_/g, ' ');
  return `<span class="status-pill">${escapeHtml(label)}</span>`;
}

function buildCashierMemberProfileHtml(data) {
  const member = data.member || {};
  const current = data.currentMonthStatus || {};
  const deposits = data.deposits || [];
  const monthlyHistory = (data.monthlyHistory || []).slice().reverse();
  const contributionDues = data.contributionDues || [];
  const refunds = data.refunds || [];
  const avatar = member.profilePicture
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name || 'Member')}&background=0f766e&color=fff`;

  const monthStatusLabel = current.status === 'paid'
    ? 'Paid'
    : current.status === 'partial'
      ? 'Partial'
      : current.status === 'no_target'
        ? 'No target set'
        : 'Unpaid';

  return `
    <div class="member-profile-shell">
      <section class="member-profile-section member-profile-section-hero">
        <div class="member-profile-summary">
          <img src="${escapeHtml(avatar)}" alt="${escapeHtml(member.name || 'Member')}" />
          <div>
            <strong>${escapeHtml(member.name || 'Member')}</strong>
            <span>${escapeHtml(member.email || '')}</span>
            <div class="member-profile-meta u-mt-1">
              <span class="member-profile-meta-pill">${escapeHtml(member.status || 'active')}</span>
              <span class="member-profile-meta-pill">Phone: ${escapeHtml(member.phone || '—')}</span>
            </div>
          </div>
        </div>
        <div class="member-profile-stats stats-grid u-mt-1">
          <div class="stat-card"><h3>${money(member.savings)}</h3><p>Savings</p></div>
          <div class="stat-card"><h3>${money(data.advanceBalance ?? member.advanceBalance)}</h3><p>Advance balance</p></div>
          <div class="stat-card"><h3>${money(member.profit)}</h3><p>Profit</p></div>
          <div class="stat-card"><h3>${money(data.totalDeposits)}</h3><p>Lifetime deposits</p></div>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <h3>Current month contribution</h3>
          ${statusPill(monthStatusLabel)}
        </div>
        <p class="text-secondary">${escapeHtml(current.monthLabel || current.yearMonth || '—')}</p>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead>
              <tr><th>Target</th><th>Paid</th><th>Still due</th><th>Surplus → advance</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>${current.targetAmount != null ? money(current.targetAmount) : '—'}</td>
                <td>${money(current.paidAmount)}</td>
                <td>${money(current.unpaidAmount)}</td>
                <td>${money(current.surplusToAdvance)}</td>
                <td>${statusPill(monthStatusLabel)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <h3>Monthly contribution history</h3>
          <span class="member-profile-meta-pill">${data.completedPayments || 0} paid · ${data.missedPayments || 0} missed/unpaid</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead>
              <tr><th>Month</th><th>Expected</th><th>Paid</th><th>Unpaid</th><th>Advance surplus</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${(contributionDues.length
    ? contributionDues
    : monthlyHistory.map((h) => ({
      yearMonth: h.yearMonth || h.label,
      expectedAmount: h.expectedAmount,
      paidAmount: h.regularAmount ?? h.amount,
      unpaidAmount: h.unpaidAmount,
      surplusToAdvance: h.advanceAmount,
      status: h.status,
    }))
  ).map((row) => `
                <tr>
                  <td>${escapeHtml(row.yearMonth || row.label || '—')}</td>
                  <td>${row.expectedAmount != null ? money(row.expectedAmount) : '—'}</td>
                  <td>${money(row.paidAmount)}</td>
                  <td>${row.unpaidAmount != null ? money(row.unpaidAmount) : '—'}</td>
                  <td>${money(row.surplusToAdvance)}</td>
                  <td>${statusPill(row.status)}</td>
                </tr>
              `).join('') || '<tr><td colspan="6">No contribution records yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <h3>12-month deposit timeline</h3>
        </div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead>
              <tr><th>Month</th><th>Deposited</th><th>Toward target</th><th>To advance</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${monthlyHistory.map((row) => `
                <tr>
                  <td>${escapeHtml(row.label)}</td>
                  <td>${money(row.amount)}</td>
                  <td>${money(row.regularAmount)}</td>
                  <td>${money(row.advanceAmount)}</td>
                  <td>${statusPill(row.status)}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">No history.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <h3>Full deposit / transaction ledger</h3>
          <span class="member-profile-meta-pill">${deposits.length} records</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Month</th><th>Amount</th><th>Notes</th><th>Receipt</th></tr>
            </thead>
            <tbody>
              ${deposits.length
    ? deposits.map((d) => `
                  <tr>
                    <td>${escapeHtml(d.createdAt ? new Date(d.createdAt).toLocaleString() : '—')}</td>
                    <td>${escapeHtml(d.type || 'regular')}</td>
                    <td>${escapeHtml(d.yearMonth || '—')}</td>
                    <td>${money(d.amount)}</td>
                    <td>${escapeHtml(d.notes || '—')}</td>
                    <td>${d._id ? `<a href="/api/admin/deposits/${d._id}/receipt" target="_blank" rel="noopener">PDF</a>` : '—'}</td>
                  </tr>
                `).join('')
    : '<tr><td colspan="6">No deposits recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      ${refunds.length ? `
      <section class="member-profile-section">
        <div class="member-profile-section-header"><h3>Refunds</h3></div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              ${refunds.map((r) => `
                <tr>
                  <td>${escapeHtml(r.createdAt ? new Date(r.createdAt).toLocaleString() : '—')}</td>
                  <td>${money(r.amount)}</td>
                  <td>${statusPill(r.status)}</td>
                  <td>${escapeHtml(r.reason || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
      ` : ''}
    </div>
  `;
}

async function openCashierMemberProfile(memberId) {
  const modal = document.getElementById('cashierMemberProfileModal');
  const content = document.getElementById('cashierMemberProfileContent');
  const title = document.getElementById('cashierMemberProfileTitle');
  const pdfBtn = document.getElementById('cashierMemberPdfBtn');
  if (!modal || !content || !memberId) return;

  activeMemberProfileId = memberId;
  modal.classList.remove('hidden');
  content.innerHTML = '<p class="text-secondary">Loading member ledger…</p>';
  if (title) title.textContent = 'Member profile';
  if (pdfBtn) pdfBtn.classList.add('hidden');

  try {
    const response = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/profile`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load member profile.');

    if (title) title.textContent = `${data.member?.name || 'Member'} — ledger`;
    content.innerHTML = buildCashierMemberProfileHtml(data);
    if (pdfBtn) {
      pdfBtn.classList.remove('hidden');
      pdfBtn.onclick = () => {
        triggerPdfDownload(
          pdfBtn,
          `/api/admin/members/${encodeURIComponent(memberId)}/ledger.pdf`
        );
      };
    }
  } catch (error) {
    content.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

function buildCashierInvestorProfileHtml(data) {
  const investor = data.investor || {};
  const summary = data.summary || {};
  const investments = data.investments || [];
  const byType = data.byType || [];

  return `
    <div class="member-profile-shell">
      <section class="member-profile-section member-profile-section-hero">
        <div class="member-profile-summary">
          <div>
            <strong>${escapeHtml(investor.name || 'Investor')}</strong>
            <span>${escapeHtml(investor.email || '')}</span>
            <div class="member-profile-meta u-mt-1">
              <span class="member-profile-meta-pill">${escapeHtml(investor.status || 'active')}</span>
              <span class="member-profile-meta-pill">Phone: ${escapeHtml(investor.phone || '—')}</span>
            </div>
          </div>
        </div>
        <div class="member-profile-stats stats-grid u-mt-1">
          <div class="stat-card"><h3>${money(summary.totalAmount)}</h3><p>Total invested</p></div>
          <div class="stat-card"><h3>${money(summary.activeAmount)}</h3><p>Active amount</p></div>
          <div class="stat-card"><h3>${money(summary.soldAmount)}</h3><p>Sold amount</p></div>
          <div class="stat-card"><h3>${summary.totalInvestments || 0}</h3><p>Projects</p></div>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header"><h3>Investments by type</h3></div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead><tr><th>Type</th><th>Count</th><th>Total</th><th>Active</th><th>Sold</th></tr></thead>
            <tbody>
              ${byType.map((row) => `
                <tr>
                  <td>${escapeHtml(row.investmentType || '—')}</td>
                  <td>${row.count || 0}</td>
                  <td>${money(row.totalAmount)}</td>
                  <td>${money(row.activeAmount)}</td>
                  <td>${money(row.soldAmount)}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">No investments by type.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <h3>Investment transaction history</h3>
          <span class="member-profile-meta-pill">${investments.length} records</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Code</th><th>Type</th><th>Status</th><th>Amount</th><th>Profit</th></tr></thead>
            <tbody>
              ${investments.map((item) => `
                <tr>
                  <td>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString() : '—')}</td>
                  <td>${escapeHtml(item.investmentCode || '—')}</td>
                  <td>${escapeHtml(item.investmentType || item.sector || '—')}</td>
                  <td>${statusPill(item.status)}</td>
                  <td>${money(item.amount)}</td>
                  <td>${money(item.profit)}</td>
                </tr>
              `).join('') || '<tr><td colspan="6">No investments recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

async function openCashierInvestorProfile(investorId) {
  const modal = document.getElementById('cashierInvestorProfileModal');
  const content = document.getElementById('cashierInvestorProfileContent');
  const title = document.getElementById('cashierInvestorProfileTitle');
  const pdfBtn = document.getElementById('cashierInvestorPdfBtn');
  if (!modal || !content || !investorId) return;

  activeInvestorProfileId = investorId;
  modal.classList.remove('hidden');
  content.innerHTML = '<p class="text-secondary">Loading investor portfolio…</p>';
  if (title) title.textContent = 'Investor portfolio';
  if (pdfBtn) pdfBtn.classList.add('hidden');

  try {
    const response = await fetch(`/api/admin/investors/${encodeURIComponent(investorId)}/profile`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load investor portfolio.');

    if (title) title.textContent = `${data.investor?.name || 'Investor'} — portfolio`;
    content.innerHTML = buildCashierInvestorProfileHtml(data);
    if (pdfBtn) {
      pdfBtn.classList.remove('hidden');
      pdfBtn.onclick = () => {
        triggerPdfDownload(
          pdfBtn,
          `/api/admin/investors/${encodeURIComponent(investorId)}/ledger.pdf`
        );
      };
    }
  } catch (error) {
    content.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

function closeCashierInvestorProfile() {
  const modal = document.getElementById('cashierInvestorProfileModal');
  if (modal) modal.classList.add('hidden');
}

function bindCashierInvestorProfileModal() {
  const modal = document.getElementById('cashierInvestorProfileModal');
  const closeBtn = document.getElementById('cashierInvestorProfileClose');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';

  closeBtn?.addEventListener('click', closeCashierInvestorProfile);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeCashierInvestorProfile();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeCashierInvestorProfile();
    }
  });
}

function bindCashierMemberProfileModal() {
  const modal = document.getElementById('cashierMemberProfileModal');
  const closeBtn = document.getElementById('cashierMemberProfileClose');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';

  closeBtn?.addEventListener('click', closeCashierMemberProfile);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeCashierMemberProfile();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeCashierMemberProfile();
    }
  });
}

function formatLoanPaymentMethodLabel(method = '') {
  const labels = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    mobile_banking: 'Mobile Banking',
    check: 'Check',
    other: 'Other',
  };
  return labels[method] || method || 'N/A';
}

function buildCashierLoanPaymentOptions(selected = '') {
  return [
    ['cash', 'Cash'],
    ['bank_transfer', 'Bank Transfer'],
    ['mobile_banking', 'Mobile Banking'],
    ['check', 'Check'],
    ['other', 'Other'],
  ].map(([value, label]) => `
    <option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>
  `).join('');
}

function buildCashierDisburseCard(loan = {}) {
  const member = loan.member || {};
  return `
    <article class="panel-card u-mb-1" data-cashier-loan-id="${loan._id}">
      <h4>${escapeHtml(member.name || 'Member')} — ${escapeHtml(loan.loanType || 'loan')}</h4>
      <p class="table-subtitle">
        Amount <strong>${money(loan.amount)}</strong>
        · Approved payment hint: ${escapeHtml(formatLoanPaymentMethodLabel(loan.paymentMethod))}
        ${loan.approvedAt ? `· Approved ${new Date(loan.approvedAt).toLocaleString()}` : ''}
      </p>
      <form class="cashier-loan-disburse-form add-member-form" data-loan-id="${loan._id}">
        <div class="form-row-2">
          <div class="form-group">
            <label>Funding source
              <select name="fundingSource" required>
                <option value="reserve">Emergency / Reserve Fund</option>
                <option value="bank">Society book balance</option>
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Transfer method
              <select name="paymentMethod" required>
                <option value="">Select…</option>
                ${buildCashierLoanPaymentOptions(loan.paymentMethod || '')}
              </select>
            </label>
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>Transfer reference
              <input type="text" name="transferReference" placeholder="Txn / receipt #" />
            </label>
          </div>
          <div class="form-group">
            <label>Transfer note
              <input type="text" name="disbursementNote" placeholder="Cash given at office…" />
            </label>
          </div>
        </div>
        <button type="submit" class="primary-btn">Confirm Transfer &amp; Disburse</button>
        <p class="message cashier-loan-disburse-msg"></p>
      </form>
    </article>
  `;
}

let cashierLoanBorrowersCache = [];
let cashierLoansUiBound = false;
let cashierLoanRepayState = null;

function formatLoanScheduleStatus(status) {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'due') return 'Due now';
  return 'Upcoming';
}

function renderCashierLoanSchedule(schedule) {
  const body = document.getElementById('cashierLoanScheduleBody');
  if (!body) return;
  const rows = schedule?.rows || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">No installment schedule available.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => {
    const statusClass = row.status === 'paid'
      ? 'cashier-loan-schedule-paid'
      : (row.status === 'due' || row.status === 'partial' ? 'cashier-loan-schedule-due' : '');
    return `
      <tr>
        <td>${row.period}</td>
        <td>${row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—'}</td>
        <td>${money(row.amount)}</td>
        <td>${money(row.paidToward)}</td>
        <td class="${statusClass}">${escapeHtml(formatLoanScheduleStatus(row.status))}</td>
      </tr>
    `;
  }).join('');
}

function renderCashierLoanRepayDetail(summary, memberMeta = {}) {
  const detail = document.getElementById('cashierLoanRepayDetail');
  const originalEl = document.getElementById('cashierLoanDetailOriginal');
  const paidEl = document.getElementById('cashierLoanDetailPaid');
  const remainingEl = document.getElementById('cashierLoanDetailRemaining');
  const statusEl = document.getElementById('cashierLoanDetailStatus');
  const metaEl = document.getElementById('cashierLoanDetailMeta');
  const hint = document.getElementById('cashierLoanRepayHint');
  const amountInput = document.getElementById('cashierLoanRepayAmount');
  const memberIdInput = document.getElementById('cashierLoanRepayMemberId');
  const typeSelect = document.getElementById('cashierLoanRepayType');

  if (!detail) return;
  detail.classList.remove('hidden');

  const original = Number(summary.originalAmount || 0);
  const paid = Number(summary.totalRepaid || 0);
  const remaining = Number(summary.availableToPay ?? summary.outstandingBalance ?? 0);
  const name = memberMeta.name || summary.loan?.member?.name || 'Member';

  if (originalEl) originalEl.textContent = money(original);
  if (paidEl) paidEl.textContent = money(paid);
  if (remainingEl) remainingEl.textContent = money(remaining);
  if (statusEl) statusEl.textContent = summary.displayStatus || (summary.hasOutstandingLoan ? 'Active' : 'Completed / Paid');
  if (metaEl) {
    const nextDue = summary.nextDueDate || summary.schedule?.nextDueDate;
    metaEl.textContent = `${name} · ${summary.loanType || 'general'} loan`
      + (summary.disbursedAt ? ` · disbursed ${new Date(summary.disbursedAt).toLocaleDateString()}` : '')
      + (nextDue && summary.hasOutstandingLoan ? ` · next due ${new Date(nextDue).toLocaleDateString()}` : '');
  }

  if (memberIdInput) memberIdInput.value = memberMeta.memberId || '';
  renderCashierLoanSchedule(summary.schedule);

  if (amountInput) {
    amountInput.max = remaining > 0 ? remaining : undefined;
    const suggested = Number(summary.suggestedInstallment || remaining || 0);
    if (typeSelect?.value === 'full') {
      amountInput.value = remaining > 0 ? remaining.toFixed(2) : '';
    } else if (suggested > 0) {
      amountInput.value = suggested.toFixed(2);
    }
  }

  if (hint) {
    if (!summary.hasOutstandingLoan) {
      hint.textContent = 'This loan is fully paid (Completed / Paid). No further payment needed.';
    } else {
      hint.textContent = `Available to collect now: ${money(remaining)}`
        + (summary.suggestedInstallment
          ? ` · Suggested installment: ${money(summary.suggestedInstallment)}`
          : '');
    }
  }

  const submitBtn = document.getElementById('cashierLoanRepaySubmitBtn');
  if (submitBtn) submitBtn.disabled = !summary.hasOutstandingLoan || !(remaining > 0);
}

async function loadCashierLoanRepayDetail(memberId, memberMeta = {}) {
  const hint = document.getElementById('cashierLoanRepayHint');
  const msg = document.getElementById('cashierLoanRepayMessage');
  if (!memberId) return null;
  if (msg) {
    msg.textContent = '';
    msg.classList.remove('success', 'error');
  }
  if (hint) hint.textContent = 'Loading loan details…';

  try {
    const response = await fetch(`/api/loans/admin/member/${encodeURIComponent(memberId)}/outstanding`);
    const summary = await response.json();
    if (!response.ok) throw new Error(summary.error || 'Unable to load loan details.');

    const borrower = cashierLoanBorrowersCache.find((row) => String(row.memberId || row.member?._id) === String(memberId));
    const meta = {
      memberId: String(memberId),
      name: memberMeta.name || borrower?.member?.name || borrower?.name || summary.loan?.member?.name || 'Member',
      phone: memberMeta.phone || borrower?.member?.phone || '',
      email: memberMeta.email || borrower?.member?.email || '',
    };
    cashierLoanRepayState = { memberId: meta.memberId, summary, meta };
    renderCashierLoanRepayDetail(summary, meta);

    const select = document.getElementById('cashierLoanRepayMember');
    if (select && [...select.options].some((opt) => opt.value === String(memberId))) {
      select.value = String(memberId);
    }
    return summary;
  } catch (error) {
    if (hint) hint.textContent = error.message;
    if (msg) {
      msg.classList.add('error');
      msg.textContent = error.message;
    }
    return null;
  }
}

function renderCashierLoanSearchResults(query) {
  const box = document.getElementById('cashierLoanRepaySearchResults');
  if (!box) return;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const matches = cashierLoanBorrowersCache.filter((row) => {
    const member = row.member || {};
    const hay = [
      member.name,
      row.name,
      member.email,
      member.phone,
      row.memberId,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    return hay.includes(q);
  }).slice(0, 8);

  if (!matches.length) {
    box.hidden = false;
    box.innerHTML = '<p class="text-secondary">No active borrowers match that search.</p>';
    return;
  }

  box.hidden = false;
  box.innerHTML = matches.map((row) => {
    const member = row.member || {};
    const id = row.memberId || member._id;
    return `
      <button type="button" class="cashier-loan-search-item" data-loan-borrower-id="${escapeHtml(String(id))}"
        data-loan-borrower-name="${escapeHtml(member.name || row.name || 'Member')}">
        <span>
          <strong>${escapeHtml(member.name || row.name || 'Member')}</strong><br>
          <small class="text-secondary">${escapeHtml(member.phone || member.email || '—')}</small>
        </span>
        <strong>${money(row.totalOutstanding)}</strong>
      </button>
    `;
  }).join('');

  box.querySelectorAll('[data-loan-borrower-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const search = document.getElementById('cashierLoanRepaySearch');
      if (search) search.value = btn.dataset.loanBorrowerName || '';
      box.hidden = true;
      void loadCashierLoanRepayDetail(btn.dataset.loanBorrowerId, {
        memberId: btn.dataset.loanBorrowerId,
        name: btn.dataset.loanBorrowerName,
      });
    });
  });
}

async function loadLoansModule() {
  const tbody = document.getElementById('cashierLoansBody');
  const queueEl = document.getElementById('cashierLoanDisburseQueue');
  const repaymentsBody = document.getElementById('cashierLoanRepaymentsBody');
  const repaySelect = document.getElementById('cashierLoanRepayMember');
  bindCashierLoansUi();

  try {
    const [allRes, borrowersRes, repaymentsRes, summaryRes] = await Promise.all([
      fetch('/api/loans/admin'),
      fetch('/api/loans/admin/active-borrowers'),
      fetch('/api/loans/admin/repayments'),
      fetch('/api/loans/admin/summary'),
    ]);

    const allData = await allRes.json();
    const borrowersData = await borrowersRes.json();
    const repaymentsData = await repaymentsRes.json();
    const summaryData = summaryRes.ok ? await summaryRes.json() : {};

    if (!allRes.ok) throw new Error(allData.error || 'Unable to load loans.');

    const allLoans = allData.loans || [];
    const pendingLoans = allLoans.filter((loan) => loan.status === 'pending' && !loan.autoRejected);
    const approvedLoans = allLoans.filter((loan) => loan.status === 'approved' && !loan.autoRejected);
    const borrowers = borrowersData.borrowers || [];
    const repayments = repaymentsData.repayments || [];
    cashierLoanBorrowersCache = borrowers;

    const pendingCountEl = document.getElementById('cashierLoanPendingCount');
    const awaitingEl = document.getElementById('cashierLoanAwaitingCount');
    const activeEl = document.getElementById('cashierLoanActiveCount');
    const outstandingEl = document.getElementById('cashierLoanOutstandingTotal');
    if (pendingCountEl) pendingCountEl.textContent = String(pendingLoans.length);
    if (awaitingEl) awaitingEl.textContent = String(approvedLoans.length);
    if (activeEl) activeEl.textContent = String(borrowers.length);
    if (outstandingEl) {
      const totalOut = Number(summaryData.totalOutstanding ?? borrowers.reduce((sum, row) => sum + Number(row.totalOutstanding || 0), 0));
      outstandingEl.textContent = money(totalOut);
    }

    const pendingBody = document.getElementById('cashierLoanPendingBody');
    if (pendingBody) {
      pendingBody.innerHTML = pendingLoans.length
        ? pendingLoans.map((loan) => `
          <tr>
            <td>${escapeHtml(loan.member?.name || 'Unknown')}</td>
            <td>${money(loan.amount)}</td>
            <td>${escapeHtml(loan.loanType || '—')}</td>
            <td>${loan.createdAt ? escapeHtml(new Date(loan.createdAt).toLocaleString()) : '—'}</td>
            <td>${escapeHtml(translateStatus(loan.status || 'pending'))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="5">No pending member loan requests.</td></tr>';
    }

    if (queueEl) {
      queueEl.innerHTML = approvedLoans.length
        ? approvedLoans.map((loan) => buildCashierDisburseCard(loan)).join('')
        : '<p class="text-secondary">No CEO-approved loans waiting for disbursement.</p>';
    }

    if (repaySelect) {
      const previous = repaySelect.value || cashierLoanRepayState?.memberId || '';
      repaySelect.innerHTML = `<option value="">Select active borrower…</option>${borrowers.map((row) => `
        <option value="${row.memberId || row.member?._id || ''}" data-outstanding="${Number(row.totalOutstanding || 0)}">
          ${escapeHtml(row.member?.name || row.name || 'Member')} — due ${money(row.totalOutstanding)}
        </option>
      `).join('')}`;
      if (previous && [...repaySelect.options].some((opt) => opt.value === String(previous))) {
        repaySelect.value = String(previous);
      }
    }

    if (cashierLoanRepayState?.memberId) {
      void loadCashierLoanRepayDetail(cashierLoanRepayState.memberId, cashierLoanRepayState.meta);
    }

    if (tbody) {
      tbody.innerHTML = allLoans.length
        ? allLoans.slice(0, 40).map((loan) => {
          const statusLabel = loan.status === 'completed' || loan.repaymentStatus === 'paid_off'
            ? 'Completed / Paid'
            : (loan.status || '—');
          return `
          <tr>
            <td>${escapeHtml(loan.member?.name || 'Unknown')}</td>
            <td>${money(loan.amount)}</td>
            <td>${escapeHtml(loan.loanType || '—')}</td>
            <td>${escapeHtml(translateStatus(statusLabel))}</td>
            <td>${loan.status === 'disbursed'
              ? `${escapeHtml(formatLoanPaymentMethodLabel(loan.paymentMethod))}${loan.disbursementReference ? ` · ${escapeHtml(loan.disbursementReference)}` : ''}`
              : loan.status === 'approved' ? 'Awaiting Cashier'
                : loan.status === 'completed' ? 'Cleared' : '—'}</td>
          </tr>
        `;
        }).join('')
        : '<tr><td colspan="5">No loan applications yet.</td></tr>';
    }

    if (repaymentsBody) {
      repaymentsBody.innerHTML = repayments.length
        ? repayments.slice(0, 40).map((item) => `
          <tr>
            <td>${escapeHtml(item.member?.name || 'Unknown')}</td>
            <td>${money(item.amount)}</td>
            <td>${item.repaymentType === 'full' ? 'Full' : 'Installment'}</td>
            <td>${escapeHtml(formatLoanPaymentMethodLabel(item.paymentMethod))}</td>
            <td>${escapeHtml(translateStatus(item.status || '—'))}</td>
            <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
            <td>${item.status === 'approved' && item._id
              ? `<a href="/api/loans/admin/repayments/${item._id}/receipt" class="receipt-button" target="_blank" rel="noopener">Receipt</a>`
              : '—'}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="7">No loan repayments recorded yet.</td></tr>';
    }
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    if (queueEl) queueEl.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
    if (repaymentsBody) repaymentsBody.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

function bindCashierLoansUi() {
  if (cashierLoansUiBound) return;
  cashierLoansUiBound = true;

  let searchTimer = null;
  document.getElementById('cashierLoanRepaySearch')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderCashierLoanSearchResults(event.target.value);
    }, 180);
  });

  document.getElementById('cashierLoanRepayMember')?.addEventListener('change', (event) => {
    const memberId = event.target.value;
    if (!memberId) {
      cashierLoanRepayState = null;
      document.getElementById('cashierLoanRepayDetail')?.classList.add('hidden');
      return;
    }
    const option = event.target.selectedOptions?.[0];
    void loadCashierLoanRepayDetail(memberId, {
      memberId,
      name: option?.textContent?.split('—')?.[0]?.trim() || 'Member',
    });
  });

  document.getElementById('cashierLoanRepayType')?.addEventListener('change', (event) => {
    const amountInput = document.getElementById('cashierLoanRepayAmount');
    const summary = cashierLoanRepayState?.summary;
    if (!amountInput || !summary) return;
    const remaining = Number(summary.availableToPay ?? summary.outstandingBalance ?? 0);
    if (event.target.value === 'full' && remaining > 0) {
      amountInput.value = remaining.toFixed(2);
    } else if (summary.suggestedInstallment > 0) {
      amountInput.value = Number(summary.suggestedInstallment).toFixed(2);
    }
  });

  document.getElementById('cashierLoanDisburseQueue')?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.cashier-loan-disburse-form');
    if (!form) return;
    event.preventDefault();
    const loanId = form.dataset.loanId;
    const msg = form.querySelector('.cashier-loan-disburse-msg');
    const formData = new FormData(form);
    if (msg) msg.textContent = '';
    try {
      const response = await fetch(`/api/loans/admin/${loanId}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: formData.get('paymentMethod'),
          transferReference: formData.get('transferReference'),
          disbursementNote: formData.get('disbursementNote'),
          fundingSource: formData.get('fundingSource') || 'reserve',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to disburse loan.');
      if (msg) {
        msg.classList.add('success');
        const sourceLabel = data.fundingSource === 'reserve' ? 'Emergency / Reserve Fund' : 'book balance';
        msg.textContent = `Loan disbursed from ${sourceLabel}.`
          + (data.reserveBalance != null ? ` Reserve now ${money(data.reserveBalance)}.` : '')
          + (data.bookBalance != null ? ` Book balance now ${money(data.bookBalance)}.` : '');
      }
      invalidateStaffViewCache?.(['loans', 'home', 'ledger', 'queue', 'reserve']);
      await loadLoansModule();
      markStaffViewCache?.('loans');
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('cashierLoanRepaymentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierLoanRepayMessage');
    if (msg) {
      msg.classList.remove('success', 'error');
      msg.textContent = '';
    }
    const formData = new FormData(event.target);
    const memberId = formData.get('memberId') || document.getElementById('cashierLoanRepayMemberId')?.value;
    if (!memberId) {
      if (msg) {
        msg.classList.add('error');
        msg.textContent = 'Select or search for a borrower first.';
      }
      return;
    }

    const submitBtn = document.getElementById('cashierLoanRepaySubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch(`/api/loans/admin/member/${encodeURIComponent(memberId)}/repayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: formData.get('amount'),
          repaymentType: formData.get('repaymentType'),
          paymentMethod: formData.get('paymentMethod'),
          adminNote: formData.get('adminNote'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to record loan payment.');

      const summary = data.summary || {};
      const remaining = Number(summary.outstandingBalance || 0);
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message
          || (data.loanCleared || !summary.hasOutstandingLoan
            ? 'Payment recorded. Loan is now Completed / Paid. Member dashboard will show the cleared balance.'
            : `Payment recorded. Remaining due: ${money(remaining)}.`);
      }

      event.target.reset();
      document.getElementById('cashierLoanRepayMemberId').value = memberId;
      invalidateStaffViewCache?.(['loans', 'home', 'ledger', 'queue']);
      await loadLoansModule();
      markStaffViewCache?.('loans');
      await loadCashierLoanRepayDetail(memberId, cashierLoanRepayState?.meta);
    } catch (error) {
      if (msg) {
        msg.classList.add('error');
        msg.textContent = error.message;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function loadInvestmentsModule() {
  const el = document.getElementById('cashierInvestmentsList');
  try {
    const response = await fetch('/api/admin/investments/cashier-queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load investments.');
    const queue = data.queue || [];
    if (el) {
      el.innerHTML = queue.length
        ? `<p>${queue.length} investment(s) awaiting cashier payment.</p>`
        : '<p class="text-secondary">No investments awaiting payment. Open Payment Queue for details when items arrive.</p>';
    }
  } catch (error) {
    if (el) el.innerHTML = `<p class="text-secondary">${escapeHtml(error.message)}</p>`;
  }
}

function bindLedgerForms() {
  document.getElementById('ledgerOpeningForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('ledgerMessage');
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/admin/bank-ledger/opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: formData.get('amount') }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to set opening balance.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = 'Opening bank balance saved.';
      }
      await loadBankLedger();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('ledgerReconcileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('ledgerMessage');
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/admin/bank-ledger/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualBalance: formData.get('actualBalance') }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to reconcile.');
      if (msg) {
        msg.classList.toggle('success', !data.mismatched);
        msg.textContent = data.mismatched
          ? `Reconciled with mismatch of ${money(data.difference)}.`
          : 'Reconciled — balances match.';
      }
      await loadBankLedger();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  const openZ = () => {
    const today = new Date().toISOString().slice(0, 10);
    void window.PdfLanguage?.open?.(`/api/admin/bank-ledger/z-report.pdf?date=${today}`);
  };
  document.getElementById('zReportBtn')?.addEventListener('click', openZ);
  document.getElementById('cashierZReportBtn')?.addEventListener('click', openZ);
}

function bindProfitPoolForms() {
  if (bindProfitPoolForms.bound) return;
  bindProfitPoolForms.bound = true;

  const staffProfitFormState = new WeakMap();
  let staffProfitLookupTimer = null;

  function getStaffProfitFields(form) {
    return {
      codeInput: form.querySelector('.profit-code-input'),
      nameInput: form.querySelector('.profit-name-input'),
      dobInput: form.querySelector('.profit-dob-input'),
      locationInput: form.querySelector('.profit-location-input'),
      amountInput: form.querySelector('.profit-amount-input'),
      saleInput: form.querySelector('.profit-sale-input'),
      profitInput: form.querySelector('.profit-profit-input'),
      statusEl: form.querySelector('.profit-lookup-status'),
      messageEl: form.querySelector('.profit-form-message'),
    };
  }

  function clearStaffProfitAutofill(form) {
    const fields = getStaffProfitFields(form);
    staffProfitFormState.delete(form);
    if (fields.nameInput) fields.nameInput.value = '';
    if (fields.dobInput) fields.dobInput.value = '';
    if (fields.locationInput) fields.locationInput.value = '';
    if (fields.amountInput) fields.amountInput.value = '';
    if (fields.profitInput) fields.profitInput.value = '';
  }

  function updateStaffCalculatedProfit(form) {
    const fields = getStaffProfitFields(form);
    const selected = staffProfitFormState.get(form);
    if (!selected || !fields.saleInput || !fields.profitInput) return;
    const invested = Number(selected.amount || selected.investmentAmount || 0);
    const sale = Number(fields.saleInput.value || 0);
    if (Number.isFinite(sale) && Number.isFinite(invested)) {
      fields.profitInput.value = Number((sale - invested).toFixed(2));
    }
  }

  async function lookupStaffInvestmentForProfit(form, code) {
    const fields = getStaffProfitFields(form);
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) {
      clearStaffProfitAutofill(form);
      if (fields.statusEl) fields.statusEl.textContent = 'Enter an Investment ID to load details.';
      return;
    }
    try {
      if (fields.statusEl) fields.statusEl.textContent = 'Looking up investment…';
      const response = await fetch(`/api/admin/profit/investment-lookup/${encodeURIComponent(normalized)}`);
      const data = await response.json();
      if (!response.ok) {
        clearStaffProfitAutofill(form);
        if (fields.statusEl) fields.statusEl.textContent = data.error || 'Investment not found.';
        return;
      }
      const investment = data.investment || {};
      staffProfitFormState.set(form, investment);
      if (fields.nameInput) fields.nameInput.value = investment.investorName || investment.investor?.name || '';
      if (fields.dobInput) fields.dobInput.value = investment.dateOfBirth || '';
      if (fields.locationInput) fields.locationInput.value = investment.location || '';
      if (fields.amountInput) fields.amountInput.value = money(investment.amount || investment.investmentAmount);
      updateStaffCalculatedProfit(form);
      if (fields.statusEl) fields.statusEl.textContent = `Loaded ${investment.investmentCode || normalized}.`;
    } catch (error) {
      clearStaffProfitAutofill(form);
      if (fields.statusEl) fields.statusEl.textContent = error.message;
    }
  }

  document.querySelectorAll('#staffInvestmentProfitForm').forEach((form) => {
    const fields = getStaffProfitFields(form);
    fields.codeInput?.addEventListener('input', () => {
      clearTimeout(staffProfitLookupTimer);
      staffProfitLookupTimer = setTimeout(() => {
        void lookupStaffInvestmentForProfit(form, fields.codeInput.value);
      }, 350);
    });
    fields.codeInput?.addEventListener('blur', () => {
      void lookupStaffInvestmentForProfit(form, fields.codeInput.value);
    });
    fields.saleInput?.addEventListener('input', () => updateStaffCalculatedProfit(form));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const msg = fields.messageEl;
      if (msg) {
        msg.textContent = '';
        msg.classList.remove('success', 'error');
      }
      const formData = new FormData(form);
      try {
        const response = await fetch('/api/admin/profit/investment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            investmentCode: formData.get('investmentCode'),
            saleAmount: Number(formData.get('saleAmount')) || 0,
            profitAmount: Number(formData.get('profitAmount')) || 0,
            distributionType: 'equal',
            notes: formData.get('notes'),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to record investment profit.');
        form.reset();
        clearStaffProfitAutofill(form);
        if (msg) {
          msg.classList.add('success');
          msg.textContent = data.message || 'Investment profit recorded and distributed.';
        }
        await loadProfitPool();
      } catch (error) {
        if (msg) {
          msg.classList.add('error');
          msg.textContent = error.message;
        }
      }
    });
  });

  document.querySelectorAll('#staffInvestmentLossForm').forEach((form) => {
    const codeInput = form.querySelector('.loss-code-input');
    const nameInput = form.querySelector('.loss-name-input');
    const investedInput = form.querySelector('.loss-amount-invested-input');
    const saleInput = form.querySelector('.loss-sale-input');
    const lossInput = form.querySelector('.loss-amount-input');
    const statusEl = form.querySelector('.loss-lookup-status');
    const messageEl = form.querySelector('.loss-form-message');
    let investedAmount = 0;
    let lossLookupTimer = null;

    const updateLoss = () => {
      const sale = Number(saleInput?.value || 0);
      if (investedAmount > 0 && sale < investedAmount) {
        if (lossInput) lossInput.value = Number((investedAmount - sale).toFixed(2));
      }
    };

    const lookupLoss = async () => {
      const code = String(codeInput?.value || '').trim().toUpperCase();
      if (!code) return;
      try {
        if (statusEl) statusEl.textContent = 'Looking up investment…';
        const response = await fetch(`/api/admin/profit/investment-lookup/${encodeURIComponent(code)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Investment not found.');
        const investment = data.investment || {};
        investedAmount = Number(investment.amount || investment.investmentAmount || 0);
        if (nameInput) nameInput.value = investment.investorName || investment.investor?.name || '';
        if (investedInput) investedInput.value = money(investedAmount);
        updateLoss();
        if (statusEl) statusEl.textContent = `Loaded ${investment.investmentCode || code}.`;
      } catch (error) {
        if (statusEl) statusEl.textContent = error.message;
      }
    };

    codeInput?.addEventListener('input', () => {
      clearTimeout(lossLookupTimer);
      lossLookupTimer = setTimeout(() => { void lookupLoss(); }, 350);
    });
    codeInput?.addEventListener('blur', () => { void lookupLoss(); });
    saleInput?.addEventListener('input', updateLoss);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }
      const formData = new FormData(form);
      try {
        const response = await fetch('/api/admin/profit/investment-loss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            investmentCode: formData.get('investmentCode'),
            saleAmount: Number(formData.get('saleAmount')) || 0,
            lossAmount: Number(formData.get('lossAmount')) || 0,
            notes: formData.get('notes'),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to record investment loss.');
        form.reset();
        investedAmount = 0;
        if (messageEl) {
          messageEl.classList.add('success');
          messageEl.textContent = data.message || 'Investment loss recorded and shared.';
        }
        await loadProfitPool();
      } catch (error) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = error.message;
        }
      }
    });
  });

  document.getElementById('staffProfitDistributionForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('staffProfitDistributionMessage');
    const formData = new FormData(event.target);
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('success', 'error');
    }
    try {
      const response = await fetch('/api/admin/profit/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalAmount: Number(formData.get('totalAmount')),
          distributionType: 'equal',
          notes: formData.get('notes'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to distribute profit.');
      event.target.reset();
      if (msg) {
        msg.classList.add('success');
        msg.textContent = `Distributed ${money(data.distribution?.totalAmount || formData.get('totalAmount'))} to ${data.updatedMembers?.length || data.distribution?.memberCount || 0} members.`;
      }
      await loadProfitPool();
    } catch (error) {
      if (msg) {
        msg.classList.add('error');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('staffPreviewDividendBtn')?.addEventListener('click', async () => {
    const amountInput = document.getElementById('staffDividendPoolAmount');
    const previewBody = document.getElementById('staffDividendPreviewBody');
    const totalAmount = Number(amountInput?.value || 0);
    if (!totalAmount || totalAmount <= 0 || !previewBody) return;
    try {
      const response = await fetch('/api/admin/profit/dividend/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to preview dividend.');
      previewBody.innerHTML = (data.preview || []).map((row) => `
        <tr>
          <td>${escapeHtml(row.memberName || '-')}</td>
          <td>${money(row.savings)}</td>
          <td>${money(row.profit)}</td>
          <td>${Number(row.weight || 0).toFixed(2)}</td>
          <td>${money(row.dividendShare)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5">No active members found.</td></tr>';
    } catch (error) {
      previewBody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    }
  });

  document.getElementById('staffDividendPreviewForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('staffDividendMessage');
    const amountInput = document.getElementById('staffDividendPoolAmount');
    const totalAmount = Number(amountInput?.value || 0);
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('success', 'error');
    }
    try {
      const response = await fetch('/api/admin/profit/dividend/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmount, notes: 'Automatic dividend distribution' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to distribute dividend.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message || 'Dividend distributed successfully.';
      }
      await loadProfitPool();
    } catch (error) {
      if (msg) {
        msg.classList.add('error');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('monthlyProfitForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('profitPoolMessage');
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/admin/profit-pool/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: formData.get('amount'),
          source: formData.get('source'),
          note: formData.get('note'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to log monthly profit.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message
          || `Logged ${money(formData.get('amount'))} into the profit pool and bank ledger.`;
      }
      event.target.reset();
      await syncAfterCashIn({
        bookBalance: data.bookBalance ?? data.ledger?.bookBalance,
      });
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('distributeProfitForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('profitPoolMessage');
    const formData = new FormData(event.target);
    const amount = formData.get('amount');
    if (!window.confirm(t('staffUi.confirmDistribute', 'Distribute profit pool equally to all active members?'))) return;
    try {
      const body = { note: formData.get('note') || '' };
      if (amount) body.amount = amount;
      const response = await fetch('/api/admin/profit-pool/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to distribute.');
      if (msg) {
        msg.classList.add('success');
        const book = data.ledger?.bookBalance;
        msg.textContent = `Distributed ${money(data.distribution?.totalAmount)} to ${data.distribution?.memberCount || 0} members.`
          + (book != null ? ` Bank book balance now ${money(book)}.` : '');
        if (data.reportUrl) {
          msg.innerHTML += ` <a href="${escapeHtml(data.reportUrl)}" target="_blank" rel="noopener">Download PDF report</a>`;
        }
      }
      event.target.reset();
      await syncAfterCashIn({
        bookBalance: data.ledger?.bookBalance,
      });
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });
}

function bindModuleForms() {
  bindFundingSettleActions();
  document.getElementById('cashierSendDuesRemindersBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('cashierDuesReminderMessage');
    const button = document.getElementById('cashierSendDuesRemindersBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending reminders…';
    }
    try {
      const response = await fetch('/api/admin/dues-reminders/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'all' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to send reminders.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = `Sent ${data.sentCount || 0} reminder(s) for ${data.yearMonth || 'this month'}.`;
      }
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = t('staffUi.sendDuesReminders', 'Send dues reminders to all unpaid');
      }
    }
  });

  document.getElementById('cashierDepositForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierDepositMessage');
    const receipt = document.getElementById('cashierDepositReceipt');
    const formData = new FormData(event.target);
    const memberId = formData.get('memberId');
    try {
      const response = await fetch('/api/admin/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          amount: formData.get('amount'),
          paymentMethod: formData.get('paymentMethod') || 'cash',
          paymentReference: formData.get('paymentReference') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('adminUi.unableRecordDeposit', 'Unable to record deposit.'));
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message || 'Deposit recorded.';
      }
      if (receipt) {
        const links = [];
        if (data.receiptUrl) {
          const label = data.regularDeposit?.receiptNumber || data.receiptNumber
            ? `Fixed deposit receipt ${escapeHtml(data.regularDeposit?.receiptNumber || data.receiptNumber)}`
            : 'Download fixed deposit receipt';
          links.push(`<a href="${escapeHtml(data.receiptUrl)}" target="_blank" rel="noopener">${label}</a>`);
        }
        if (data.advanceReceiptUrl) {
          const advLabel = data.advanceDeposit?.receiptNumber
            ? `Advance receipt ${escapeHtml(data.advanceDeposit.receiptNumber)}`
            : 'Download advance receipt';
          links.push(`<a href="${escapeHtml(data.advanceReceiptUrl)}" target="_blank" rel="noopener">${advLabel}</a>`);
        }
        receipt.innerHTML = links.join(' · ');
      }
      event.target.reset();
      updateDepositSplitPreview();
      await syncAfterCashIn({
        memberId,
        bookBalance: data.bookBalance ?? data.bankLedger?.ledger?.bookBalance,
      });
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('cashierAdvanceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierAdvanceMessage');
    const formData = new FormData(event.target);
    const memberId = formData.get('memberId');
    try {
      const response = await fetch('/api/admin/funding/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          amount: formData.get('amount'),
          notes: formData.get('notes') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to record advance.');
      const book = data.bookBalance ?? data.bankLedger?.ledger?.bookBalance;
      if (msg) {
        msg.classList.add('success');
        msg.textContent = book != null
          ? `Advance credited. New advance balance: ${money(data.member?.advanceBalance)}. Bank book balance now ${money(book)}.`
          : `Advance credited. New advance balance: ${money(data.member?.advanceBalance)}. Bank ledger updated.`;
      }
      event.target.reset();
      await syncAfterCashIn({ memberId, bookBalance: book });
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('cashierBorrowForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierBorrowMessage');
    const formData = new FormData(event.target);
    const contribSelect = document.getElementById('cashierBorrowContribution');
    const opt = contribSelect?.selectedOptions?.[0];
    if (!opt?.value) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = 'Select an unpaid contribution share.';
      }
      return;
    }
    if (!formData.get('lenderId')) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = 'Select a lender with advance balance.';
      }
      return;
    }
    try {
      const response = await fetch('/api/admin/funding/borrowings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contributionId: opt.dataset.contribution || opt.value,
          investmentId: opt.dataset.investment,
          borrowerId: opt.dataset.borrower,
          lenderId: formData.get('lenderId'),
          amount: formData.get('amount'),
          note: formData.get('note') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create borrowing.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = `Borrowed ${money(data.borrowing?.amount)} from ${data.lender?.name} for ${data.borrower?.name}. Lender advance now ${money(data.lender?.advanceBalance)}.`;
      }
      event.target.reset();
      invalidateStaffViewCache(['funding']);
      await loadFundingModule();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });

  document.getElementById('cashierRefundForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('cashierRefundMessage');
    const formData = new FormData(event.target);
    const memberId = formData.get('memberId');
    try {
      const response = await fetch(`/api/admin/members/${memberId}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: formData.get('amount'),
          reason: formData.get('reason') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create refund.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = 'Refund created.';
      }
      event.target.reset();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });
}

async function init() {
  try {
    await window.I18n?.whenReady?.();
    const response = await fetch('/api/session');
    const data = await response.json();
    const user = data.user;
    if (!user) {
      window.location.href = '/';
      return;
    }

    if (['ceo', 'admin'].includes(user.role)) {
      window.location.href = '/admin';
      return;
    }
    if (user.role === 'member') {
      window.location.href = '/member';
      return;
    }
    if (user.role === 'developer') {
      window.location.href = '/user-management';
      return;
    }

    staffSessionUser = user;
    const meta = ROLE_META[user.role] || {
      title: 'Staff Dashboard',
      subtitle: `Signed in as ${user.name}`,
    };
    const roleLabel = (user.role || 'staff').replace(/_/g, ' ');

    document.getElementById('dashboardTitle').textContent = window.I18n?.t(`staff.role.${user.role}`, meta.title);
    document.getElementById('dashboardSubtitle').textContent = meta.subtitle;
    document.getElementById('roleTagline').textContent = window.OrganizationBranding?.portalLabel(
      user.role === 'cashier' ? 'cashier' : 'staff'
    ) || roleLabel;

    const initials = initialsFromName(user.name);
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('cashierSidebarName', user.name || 'Cashier');
    setText('cashierSidebarRole', roleLabel);
    setText('cashierSidebarAvatar', initials);
    setText('cashierTopName', user.name || '—');
    setText('cashierTopRole', roleLabel);
    setText('cashierTopAvatar', initials);
    setText('cashierGreeting', `${window.I18n?.t('page.staff.welcomeBack', 'Welcome back')}, ${String(user.name || 'there').split(' ')[0]}!`);
    setText('cashierHeroTitle', window.I18n?.t('page.staff.workspaceTitle', 'Your cashier workspace'));
    setText('cashierHeroNote', window.I18n?.t('page.staff.workspaceNote', 'Track this month\'s collections, open member portfolios, and use the sidebar for all modules.'));

    const permissions = new Set(user.permissions || []);
    const seenPanels = new Set();
    const features = FEATURE_CATALOG.filter((item) => {
      if (!permissions.has(item.key)) return false;
      if (seenPanels.has(item.panel)) return false;
      seenPanels.add(item.panel);
      return true;
    });
    const showQueue = user.role === 'cashier' || permissions.has('can_manage_deposits');
    const canManageLedger = showQueue;
    staffCanManageLedger = canManageLedger;
    const showLedger = canManageLedger || permissions.has('can_view_reports');
    const showTracking = showLedger && !canManageLedger;
    const showProfit = permissions.has('can_manage_profit');
    const showMembers = permissions.has('can_manage_members')
      || permissions.has('can_manage_deposits')
      || permissions.has('can_view_reports');

    const moduleCount = features.length
      + 1 // Approvals is always available
      + (canManageLedger ? 3 : 0) // ledger + audit + reserve
      + (showTracking ? 1 : 0)
      + (showQueue ? 1 : 0)
      + (showProfit && !features.some((f) => f.panel === 'profit') ? 1 : 0)
      + (showMembers && !features.some((f) => f.panel === 'members') ? 1 : 0);

    document.getElementById('permissionStats').innerHTML = `
      <div class="cashier-pill"><strong>${permissions.size}</strong><span data-i18n="page.staff.permissions">${window.I18n?.t('page.staff.permissions', 'Permissions')}</span></div>
      <div class="cashier-pill"><strong>${moduleCount}</strong><span data-i18n="page.staff.modules">${window.I18n?.t('page.staff.modules', 'Modules')}</span></div>
      <div class="cashier-pill"><strong>${escapeHtml(roleLabel)}</strong><span data-i18n="page.staff.role">${window.I18n?.t('page.staff.role', 'Role')}</span></div>
    `;

    const navParts = [];
    const addedPanels = new Set();

    const pushNav = (opts) => {
      if (addedPanels.has(opts.panel)) return;
      addedPanels.add(opts.panel);
      const titleKey = opts.titleKey || PANEL_I18N_KEYS[opts.panel] || 'nav.dashboard';
      navParts.push(navItemHtml({ ...opts, titleKey }));
    };

    navParts.push(`<p class="nav-section-label" data-i18n="nav.section.overview">${window.I18n?.t('nav.section.overview', 'Overview')}</p>`);
    pushNav({ icon: '🏠', active: true, panel: 'home' });
    pushNav({ icon: '✅', panel: 'approvals', titleKey: 'nav.approvals' });

    navParts.push(`<p class="nav-section-label" data-i18n="nav.section.finance">${window.I18n?.t('nav.section.finance', 'Finance')}</p>`);
    if (canManageLedger) pushNav({ icon: '🏛️', panel: 'ledger' });
    if (canManageLedger) pushNav({ icon: '📋', panel: 'audit' });
    if (showTracking) pushNav({ icon: '🔍', panel: 'tracking' });
    if (showQueue) pushNav({ icon: '⏳', panel: 'queue' });
    if (showQueue) pushNav({ icon: '🔄', panel: 'funding' });
    if (canManageLedger) pushNav({ icon: '🛡️', panel: 'reserve', titleKey: 'nav.emergencyReserve' });
    if (showProfit) pushNav({ icon: '💹', panel: 'profit' });

    const financePanels = new Set(['deposits', 'withdrawals', 'investments', 'refunds', 'loans', 'profit', 'funding', 'reserve']);
    features.forEach((feature) => {
      if (!financePanels.has(feature.panel)) return;
      const copy = HOME_MODULE_COPY[feature.panel] || {};
      pushNav({
        titleKey: PANEL_I18N_KEYS[feature.panel],
        icon: copy.icon || feature.icon || '•',
        panel: feature.panel,
      });
    });

    navParts.push(`<p class="nav-section-label" data-i18n="nav.section.management">${window.I18n?.t('nav.section.management', 'Management')}</p>`);
    if (showMembers) pushNav({ icon: '👥', panel: 'members' });

    features.forEach((feature) => {
      if (financePanels.has(feature.panel) || feature.panel === 'home') return;
      const copy = HOME_MODULE_COPY[feature.panel] || {};
      pushNav({
        titleKey: PANEL_I18N_KEYS[feature.panel] || `nav.${feature.panel}`,
        icon: copy.icon || feature.icon || '•',
        panel: feature.panel,
      });
    });
    document.getElementById('featureNav').innerHTML = navParts.join('');
    window.SocietyHubMobileMenu?.enhanceNav?.(document.getElementById('featureNav'));

    const membersLaunch = document.getElementById('cashierOpenMembers');
    if (membersLaunch) {
      membersLaunch.classList.toggle('hidden', !showMembers);
    }

    document.getElementById('cashierRefreshKpis')?.addEventListener('click', () => {
      invalidateStaffViewCache(['home']);
      showStaffView('home', { forceReload: true });
    });

    document.addEventListener('bbbf:languagechange', () => {
      const tagline = document.getElementById('roleTagline');
      if (tagline && staffSessionUser) {
        tagline.textContent = window.OrganizationBranding?.portalLabel(
          staffSessionUser.role === 'cashier' ? 'cashier' : 'staff'
        ) || (staffSessionUser.role || 'staff').replace(/_/g, ' ');
      }
      if (staffSessionUser) {
        const meta = ROLE_META[staffSessionUser.role] || { title: 'Staff Dashboard', subtitle: '' };
        document.getElementById('dashboardTitle').textContent = window.I18n?.t(`staff.role.${staffSessionUser.role}`, meta.title);
        setText('cashierHeroTitle', window.I18n?.t('page.staff.workspaceTitle', 'Your cashier workspace'));
        setText('cashierHeroNote', window.I18n?.t('page.staff.workspaceNote', ''));
        setText('cashierGreeting', `${window.I18n?.t('page.staff.welcomeBack', 'Welcome back')}, ${String(staffSessionUser.name || 'there').split(' ')[0]}!`);
      }
      window.I18n?.applyI18n?.();
    });
    bindStaffNavigation();
    bindLedgerForms();
    applyLedgerAdminVisibility(canManageLedger);
    bindProfitPoolForms();
    bindEmergencyReserveForms();
    bindModuleForms();
    bindAuditForms();
    bindDirectoryTabs();
    bindCashierMemberProfileModal();
    bindCashierInvestorProfileModal();
    bindCashierPaymentShortfallModal();

    const initial = (window.location.hash || '#home').replace(/^#/, '') || 'home';
    showStaffView(initial, { forceReload: true });
    void refreshStaffApprovalsBadge();

    document.getElementById('staffApprovalsRefreshBtn')?.addEventListener('click', () => {
      invalidateStaffViewCache(['approvals']);
      void loadStaffApprovalsInbox();
    });
  } catch (error) {
    document.getElementById('dashMessage').textContent = t('staffUi.unableLoadDashboard', 'Unable to load dashboard.');
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

document.getElementById('staffSelfPasswordForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = document.getElementById('staffSelfPasswordMessage');
  msg.textContent = '';
  const formData = new FormData(event.target);
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword: formData.get('newPassword'),
      }),
      skipPasswordConfirm: true,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to update password.');
    msg.textContent = data.message || 'Password updated.';
    event.target.reset();
  } catch (error) {
    msg.textContent = error.message;
  }
});

void init();
