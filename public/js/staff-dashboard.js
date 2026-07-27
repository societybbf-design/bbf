/**
 * staff-dashboard.js — Cashier / staff workspace
 * All sidebar modules stay on /dashboard/* — never redirect to /admin (CEO panel).
 */
const ROLE_META = {
  project_manager: {
    title: 'Project Manager Dashboard',
    subtitle: 'Oversee members, investments, loans, and KYC workflows.',
  },
  cashier: {
    title: 'Cashier Dashboard',
    subtitle: 'Handle deposits, withdrawals, refunds, bank ledger, and investment payments.',
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
  { key: 'can_manage_loans', title: 'Loans', detail: 'Review loan applications.', icon: '📄', panel: 'loans' },
  { key: 'can_manage_investments', title: 'Investments', detail: 'Investment summary and payment queue.', icon: '📈', panel: 'investments' },
  { key: 'can_manage_ious', title: 'IOUs', detail: 'Investment-related tracking.', icon: '📝', panel: 'investments' },
  { key: 'can_manage_profit', title: 'Profit & Dividends', detail: 'Log and distribute monthly profits.', icon: '💹', panel: 'profit' },
  { key: 'can_manage_refunds', title: 'Refunds', detail: 'Create member refunds.', icon: '↩️', panel: 'refunds' },
  { key: 'can_manage_kyc', title: 'KYC', detail: 'KYC is handled in Settings workflows.', icon: '🪪', panel: 'home' },
  { key: 'can_view_reports', title: 'Reports', detail: 'Society summaries and Z-report.', icon: '📊', panel: 'reports' },
  { key: 'can_manage_notices', title: 'Notices', detail: 'Notices are managed from your home workspace.', icon: '📢', panel: 'home' },
  { key: 'can_manage_chat', title: 'Chat', detail: 'Member conversations.', icon: '💬', panel: 'chat' },
];

let staffSessionUser = null;
let staffMembersCache = [];
let staffCurrentView = 'home';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function navItemHtml({ title, icon, active = false, panel = 'home' }) {
  return `
    <a href="#${escapeHtml(panel)}" class="nav-item${active ? ' active' : ''}" data-staff-nav="${escapeHtml(panel)}">
      <span class="nav-icon-wrap"><span class="nav-icon" aria-hidden="true">${icon}</span></span>
      <span class="nav-label">${escapeHtml(title)}</span>
    </a>
  `;
}

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
  profit: { title: 'Profit Pool', detail: 'Log and distribute profits', icon: '💹' },
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

async function loadCashierHomeKpis() {
  const recentEl = document.getElementById('cashierRecentLedger');
  try {
    const [metricsRes, reportRes] = await Promise.all([
      fetch('/api/admin/bank-ledger/cashier-metrics'),
      fetch('/api/admin/monthly-targets/contribution-report'),
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
    return `<li class="text-secondary">${type === 'paid' ? 'No members fully paid yet.' : 'Everyone is paid up.'}</li>`;
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
    paidList.innerHTML = `<li class="text-secondary">${escapeHtml(errorMessage || 'Unable to load.')}</li>`;
    unpaidList.innerHTML = `<li class="text-secondary">${escapeHtml(errorMessage || 'Unable to load.')}</li>`;
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

function showStaffView(viewId) {
  const next = viewId || 'home';
  const prev = staffCurrentView;
  staffCurrentView = next;

  if (prev === 'chat' && next !== 'chat') {
    stopCashierChatPolling();
  }

  document.querySelectorAll('[data-staff-view]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.staffView !== next);
  });

  document.querySelectorAll('[data-staff-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.staffNav === next);
  });

  if (window.location.hash.replace(/^#/, '') !== next) {
    window.history.replaceState(null, '', `#${next}`);
  }

  Promise.resolve(loadViewData(next)).finally(() => {
    enhanceTableCards();
    window.SocietyHubSidebar?.close?.();
  });
}

async function loadViewData(viewId) {
  switch (viewId) {
    case 'home':
      return loadCashierHomeKpis();
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
    case 'withdrawals':
      return loadWithdrawalsModule();
    case 'refunds':
      return loadRefundsModule();
    case 'reports':
      return loadReportsModule();
    case 'chat':
      return loadChatModule();
    case 'members':
      return loadMembersModule();
    case 'loans':
      return loadLoansModule();
    case 'investments':
      return loadInvestmentsModule();
    default:
      return undefined;
  }
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
 * After any cash-in (deposit / advance / sale / monthly profit), refresh ledger + related views.
 */
async function syncAfterCashIn({ memberId = null, bookBalance = null } = {}) {
  applyLiveBookBalance(bookBalance);

  staffMembersCache = [];

  const tasks = [loadBankLedger()];

  tasks.push(loadDepositsModule({ skipLedgerFetch: true }).catch(() => {}));
  tasks.push(loadFundingModule().catch(() => {}));
  tasks.push(loadProfitPool({ skipLedgerFetch: true }).catch(() => {}));

  if (staffCurrentView === 'members' || staffCurrentView === 'home' || staffCurrentView === 'reports') {
    tasks.push(loadViewData(staffCurrentView).catch(() => {}));
  }

  await Promise.all(tasks);

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
}

async function loadCashierQueue() {
  const list = document.getElementById('cashierQueueList');
  const messageEl = document.getElementById('cashierQueueMessage');
  if (!list) return;
  try {
    const response = await fetch('/api/admin/investments/cashier-queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load payment queue.');
    const queue = data.queue || [];
    if (!queue.length) {
      list.innerHTML = '<p class="text-secondary">No investments awaiting cashier payment.</p>';
      return;
    }
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
          <button type="button" class="primary-btn" data-complete-payment="${item._id}">Complete Payment</button>
        </article>
      `;
    }).join('');

    list.querySelectorAll('[data-complete-payment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Complete payment? This deducts society savings and the central bank ledger.')) return;
        if (messageEl) messageEl.textContent = '';
        try {
          const res = await fetch(`/api/admin/investments/${btn.dataset.completePayment}/cashier-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Payment completed by cashier' }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Unable to complete payment.');
          if (messageEl) {
            messageEl.classList.add('success');
            messageEl.textContent = payload.message || 'Payment completed.';
            if (payload.voucherUrl) {
              messageEl.innerHTML += ` <a href="${escapeHtml(payload.voucherUrl)}" target="_blank" rel="noopener">Download voucher PDF</a>`;
            }
          }
          await loadCashierQueue();
        } catch (error) {
          if (messageEl) {
            messageEl.classList.remove('success');
            messageEl.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    if (messageEl) messageEl.textContent = error.message;
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
    await ensureMembersOptions(['cashierDepositMember', 'cashierAdvanceMember', 'cashierBorrowLender']);

    const fetches = [
      fetch('/api/admin/deposits'),
      fetch('/api/admin/monthly-targets/active'),
      fetch('/api/admin/monthly-targets/unpaid'),
    ];
    if (!options.skipLedgerFetch) {
      fetches.push(fetch('/api/admin/bank-ledger'));
    }

    const responses = await Promise.all(fetches);
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
        ? `This month’s target is ${money(target.amount)}. Extra → Advance; less → unpaid dues.`
        : 'No month target set — full amount credits savings until a target is configured.';
    }
    if (amountInput && target.amount != null && !amountInput.value) {
      amountInput.value = Number(target.amount).toFixed(2);
    }

    const dues = duesData.dues || [];
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
            <td><a href="/api/admin/deposits/${d._id}/receipt" target="_blank" rel="noopener">PDF</a></td>
          </tr>
        `).join('')
        : '<tr><td colspan="4">No deposits yet.</td></tr>';
    }
  } catch (error) {
    if (msg) msg.textContent = error.message;
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    if (duesBody) duesBody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

let unpaidContributionsCache = [];

async function loadFundingModule() {
  const advanceBody = document.getElementById('cashierAdvanceBody');
  const unpaidBody = document.getElementById('cashierUnpaidBody');
  const borrowingsBody = document.getElementById('cashierBorrowingsBody');
  const contribSelect = document.getElementById('cashierBorrowContribution');
  const lenderSelect = document.getElementById('cashierBorrowLender');
  const buyInBody = document.getElementById('cashierPendingBuyInBody');
  const buyInValBox = document.getElementById('cashierBuyInValuationBox');

  try {
    await ensureMembersOptions(['cashierAdvanceMember', 'cashierBorrowLender']);

    const [advRes, unpaidRes, borrowRes, buyInRes] = await Promise.all([
      fetch('/api/admin/funding/advances'),
      fetch('/api/admin/funding/unpaid-contributions'),
      fetch('/api/admin/funding/borrowings?status=open'),
      fetch('/api/admin/funding/pending-buyins'),
    ]);
    const advances = await advRes.json();
    const unpaid = await unpaidRes.json();
    const borrowings = await borrowRes.json();
    const buyIns = await buyInRes.json();

    if (!advRes.ok) throw new Error(advances.error || 'Unable to load advances.');
    if (!unpaidRes.ok) throw new Error(unpaid.error || 'Unable to load unpaid shares.');
    if (!borrowRes.ok) throw new Error(borrowings.error || 'Unable to load borrowings.');
    if (!buyInRes.ok) throw new Error(buyIns.error || 'Unable to load pending buy-ins.');

    const valuation = buyIns.valuation || {};
    if (buyInValBox) {
      buyInValBox.innerHTML = `
        <p><strong>Current join share valuation: ${money(valuation.entryAmount)}</strong></p>
        <p class="text-secondary">${escapeHtml(valuation.formula || '')}</p>
        <p class="text-secondary">Active members: ${valuation.activeCount || 0} · Fund ${money(valuation.totalFund)} (savings ${money(valuation.totalSavings)} + profit ${money(valuation.totalProfit)} + advance ${money(valuation.totalAdvance)})</p>
      `;
    }

    const pendingMembers = buyIns.members || [];
    if (buyInBody) {
      buyInBody.innerHTML = pendingMembers.length
        ? pendingMembers.map((m) => `
          <tr>
            <td>${escapeHtml(m.name)}<br><span class="text-secondary">${escapeHtml(m.email || '')}</span></td>
            <td>${money(m.requiredEntryAmount)}</td>
            <td>${escapeHtml(m.status)}</td>
            <td>
              <button type="button" class="primary-btn"
                data-complete-buyin="${m.id}"
                data-required="${Number(m.requiredEntryAmount || 0).toFixed(2)}">
                Record ${money(m.requiredEntryAmount)}
              </button>
            </td>
          </tr>
        `).join('')
        : '<tr><td colspan="4">No pending buy-ins.</td></tr>';
    }

    document.querySelectorAll('[data-complete-buyin]').forEach((btn) => {
      btn.onclick = async () => {
        const msg = document.getElementById('cashierBuyInMessage');
        const required = btn.dataset.required;
        if (!window.confirm(`Record exact buy-in of $${required} and activate this member?`)) return;
        try {
          const res = await fetch('/api/admin/funding/member-buyin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              memberId: btn.dataset.completeBuyin,
              amountPaid: required,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Unable to complete buy-in.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = data.message || `Buy-in of $${required} recorded. Member activated.`;
          }
          await loadFundingModule();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      };
    });

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

    if (lenderSelect) {
      const withAdvance = members.filter((m) => Number(m.advanceBalance) > 0);
      lenderSelect.innerHTML = `<option value="">Select lender…</option>${withAdvance.map((m) => `
        <option value="${m.id}">${escapeHtml(m.name)} (advance ${money(m.advanceBalance)})</option>
      `).join('')}`;
    }

    unpaidContributionsCache = unpaid.contributions || [];
    if (unpaidBody) {
      unpaidBody.innerHTML = unpaidContributionsCache.length
        ? unpaidContributionsCache.map((c) => `
          <tr>
            <td>${escapeHtml(c.investment?.investmentCode || '—')}</td>
            <td>${escapeHtml(c.memberName || c.member?.name || '—')}</td>
            <td>${money(c.unpaidAmount || c.borrowedAmount)}</td>
            <td>${escapeHtml(c.status)}</td>
            <td>
              ${c.status === 'unpaid' && Number(c.unpaidAmount) > 0 ? `
                <button type="button" class="secondary-btn" data-repay-contribution="${c._id}">Record repayment</button>
              ` : c.borrowing ? `
                <button type="button" class="secondary-btn" data-repay-borrowing="${c.borrowing._id || c.borrowing}">Settle borrow</button>
              ` : '—'}
            </td>
          </tr>
        `).join('')
        : '<tr><td colspan="5">No unpaid shares.</td></tr>';
    }

    if (contribSelect) {
      const unpaidOnly = unpaidContributionsCache.filter((c) => c.status === 'unpaid' && Number(c.unpaidAmount) > 0);
      contribSelect.innerHTML = `<option value="">Select unpaid share…</option>${unpaidOnly.map((c) => `
        <option value="${c._id}" data-amount="${c.unpaidAmount}" data-investment="${c.investment?._id || c.investment}" data-borrower="${c.member?._id || c.member}">
          ${escapeHtml(c.memberName || c.member?.name)} · ${escapeHtml(c.investment?.investmentCode || '')} · due ${money(c.unpaidAmount)}
        </option>
      `).join('')}`;
      contribSelect.onchange = () => {
        const opt = contribSelect.selectedOptions[0];
        const amountInput = document.getElementById('cashierBorrowAmount');
        if (opt && amountInput) amountInput.value = opt.dataset.amount || '';
      };
    }

    const openBorrowings = borrowings.borrowings || [];

    if (borrowingsBody) {
      borrowingsBody.innerHTML = openBorrowings.length
        ? openBorrowings.map((b) => {
          const outstanding = Math.max(0, Number(b.amount || 0) - Number(b.amountSettled || 0));
          return `
            <tr>
              <td>${escapeHtml(new Date(b.createdAt).toLocaleString())}</td>
              <td>${escapeHtml(b.borrowerName || b.borrower?.name || '—')}</td>
              <td>${escapeHtml(b.lenderName || b.lender?.name || '—')}</td>
              <td>${money(b.amount)}</td>
              <td>${money(outstanding)}</td>
              <td>
                <button type="button" class="primary-btn" data-settle-borrowing="${b._id}" data-outstanding="${outstanding}">
                  Settle full
                </button>
              </td>
            </tr>
          `;
        }).join('')
        : '<tr><td colspan="6">No open borrowings.</td></tr>';
    }

    document.querySelectorAll('[data-repay-contribution]').forEach((btn) => {
      btn.onclick = async () => {
        const msg = document.getElementById('cashierUnpaidMessage');
        if (!window.confirm('Record repayment for this unpaid share? Credits bank ledger and marks settled.')) return;
        try {
          const res = await fetch(`/api/admin/funding/unpaid-contributions/${btn.dataset.repayContribution}/repay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Unable to repay.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = 'Contribution repayment recorded. Bank ledger credited.';
          }
          await loadFundingModule();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      };
    });

    document.querySelectorAll('[data-repay-borrowing], [data-settle-borrowing]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.settleBorrowing || btn.dataset.repayBorrowing;
        const msg = document.getElementById('cashierSettleMessage') || document.getElementById('cashierUnpaidMessage');
        if (!window.confirm('Settle this borrowing? Repayment credits the bank ledger and restores the lender advance balance.')) return;
        try {
          const res = await fetch(`/api/admin/funding/borrowings/${id}/repay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Unable to settle.');
          if (msg) {
            msg.classList.add('success');
            msg.textContent = `Settled ${money(data.settledAmount)}. Lender advance restored. Bank ledger credited.`;
          }
          await loadFundingModule();
        } catch (error) {
          if (msg) {
            msg.classList.remove('success');
            msg.textContent = error.message;
          }
        }
      };
    });
  } catch (error) {
    if (advanceBody) advanceBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    if (buyInBody) buyInBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
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
            <button type="button" class="primary-btn" data-withdrawal-status="processed" data-id="${request._id}">Process</button>
          ` : '—'}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-withdrawal-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (msg) msg.textContent = '';
        try {
          const res = await fetch(`/api/withdrawals/admin/${btn.dataset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: btn.dataset.withdrawalStatus }),
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
  const pollMs = window.SocietyChat?.POLL_MS || 2500;
  cashierChatPollTimer = window.setInterval(() => {
    void refreshCashierChatThread();
    void loadCashierChatDirectory(true);
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
  document.getElementById('cashierChatReplyClear')?.addEventListener('click', () => setCashierReplyTarget(null));

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

async function loadMembersModule() {
  const tbody = document.getElementById('cashierMembersBody');
  try {
    staffMembersCache = [];
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
  if (!modal || !content || !memberId) return;

  modal.classList.remove('hidden');
  content.innerHTML = '<p class="text-secondary">Loading member ledger…</p>';
  if (title) title.textContent = 'Member profile';

  try {
    const response = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/profile`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load member profile.');

    if (title) title.textContent = `${data.member?.name || 'Member'} — ledger`;
    content.innerHTML = buildCashierMemberProfileHtml(data);
  } catch (error) {
    content.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
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

async function loadLoansModule() {
  const tbody = document.getElementById('cashierLoansBody');
  try {
    const response = await fetch('/api/loans/admin?status=pending');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load loans.');
    const loans = data.loans || [];
    if (!tbody) return;
    tbody.innerHTML = loans.length
      ? loans.map((loan) => `
        <tr>
          <td>${escapeHtml(loan.member?.name || 'Unknown')}</td>
          <td>${money(loan.amount)}</td>
          <td>${escapeHtml(loan.loanType || '—')}</td>
          <td>${escapeHtml(loan.status || '—')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">No pending loans.</td></tr>';
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
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
    window.open(`/api/admin/bank-ledger/z-report.pdf?date=${today}`, '_blank');
  };
  document.getElementById('zReportBtn')?.addEventListener('click', openZ);
  document.getElementById('cashierZReportBtn')?.addEventListener('click', openZ);
}

function bindProfitPoolForms() {
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
    if (!window.confirm('Distribute profit pool equally to all active members?')) return;
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
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to record deposit.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message || 'Deposit recorded.';
      }
      if (receipt && data.receiptUrl) {
        receipt.innerHTML = `<a href="${escapeHtml(data.receiptUrl)}" target="_blank" rel="noopener">Download deposit receipt PDF</a>`;
      }
      event.target.reset();
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
    if (!opt) return;
    try {
      const response = await fetch('/api/admin/funding/borrowings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        msg.textContent = `Borrowed ${money(data.borrowing?.amount)} from ${data.lender?.name} for ${data.borrower?.name}.`;
      }
      event.target.reset();
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

    document.getElementById('dashboardTitle').textContent = meta.title;
    document.getElementById('dashboardSubtitle').textContent = `${meta.subtitle} · ${user.email}`;
    document.getElementById('roleTagline').textContent = (user.role || 'staff').replace(/_/g, ' ');

    const initials = initialsFromName(user.name);
    const roleLabel = (user.role || 'staff').replace(/_/g, ' ');
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
    setText('cashierGreeting', `Hi ${String(user.name || 'there').split(' ')[0]}, ${greetingForHour()}!`);
    setText('cashierHeroTitle', 'Your cashier workspace');
    setText('cashierHeroNote', 'Track this month’s collections, open member portfolios, and use the sidebar for all modules.');

    const permissions = new Set(user.permissions || []);
    const seenPanels = new Set();
    const features = FEATURE_CATALOG.filter((item) => {
      if (!permissions.has(item.key)) return false;
      if (seenPanels.has(item.panel)) return false;
      seenPanels.add(item.panel);
      return true;
    });
    const showQueue = user.role === 'cashier' || permissions.has('can_manage_deposits');
    const showLedger = showQueue || permissions.has('can_view_reports');
    const showProfit = permissions.has('can_manage_profit') || permissions.has('can_manage_deposits');
    const showMembers = permissions.has('can_manage_members')
      || permissions.has('can_manage_deposits')
      || permissions.has('can_view_reports');

    const moduleCount = features.length
      + (showLedger ? 1 : 0)
      + (showQueue ? 1 : 0)
      + (showProfit && !features.some((f) => f.panel === 'profit') ? 1 : 0)
      + (showMembers && !features.some((f) => f.panel === 'members') ? 1 : 0);

    document.getElementById('permissionStats').innerHTML = `
      <div class="cashier-pill"><strong>${permissions.size}</strong><span>Permissions</span></div>
      <div class="cashier-pill"><strong>${moduleCount}</strong><span>Modules</span></div>
      <div class="cashier-pill"><strong>${escapeHtml(roleLabel)}</strong><span>Role</span></div>
    `;

    const navParts = [
      '<p class="nav-section-label">Workspace</p>',
      navItemHtml({ title: 'Dashboard', icon: '🏠', active: true, panel: 'home' }),
    ];
    if (showMembers) navParts.push(navItemHtml({ title: 'Members', icon: '👥', panel: 'members' }));
    if (showLedger) navParts.push(navItemHtml({ title: 'Bank Ledger', icon: '🏛️', panel: 'ledger' }));
    if (showQueue) navParts.push(navItemHtml({ title: 'Payment Queue', icon: '⏳', panel: 'queue' }));
    if (showQueue) navParts.push(navItemHtml({ title: 'Advances & Borrow', icon: '🔄', panel: 'funding' }));
    if (showProfit) navParts.push(navItemHtml({ title: 'Profit Pool', icon: '💹', panel: 'profit' }));

    if (features.length) {
      navParts.push('<p class="nav-section-label">Modules</p>');
      features.forEach((feature) => {
        if (feature.panel === 'members' && showMembers) return;
        if (feature.panel === 'funding' && showQueue) return;
        if (feature.panel === 'profit' && showProfit) return;
        const copy = HOME_MODULE_COPY[feature.panel] || {};
        navParts.push(navItemHtml({
          title: copy.title || feature.title,
          icon: copy.icon || feature.icon || '•',
          panel: feature.panel,
        }));
      });
    }
    document.getElementById('featureNav').innerHTML = navParts.join('');

    const membersLaunch = document.getElementById('cashierOpenMembers');
    if (membersLaunch) {
      membersLaunch.classList.toggle('hidden', !showMembers);
    }

    document.getElementById('cashierRefreshKpis')?.addEventListener('click', () => {
      void loadCashierHomeKpis();
    });

    bindStaffNavigation();
    bindLedgerForms();
    bindProfitPoolForms();
    bindModuleForms();
    bindCashierMemberProfileModal();

    const initial = (window.location.hash || '#home').replace(/^#/, '') || 'home';
    showStaffView(initial);
  } catch (error) {
    document.getElementById('dashMessage').textContent = 'Unable to load dashboard.';
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
