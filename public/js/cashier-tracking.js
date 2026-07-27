/**
 * Read-only Cashier Tracking / Transparency UI (members, investors, staff).
 */
(function initCashierTracking(global) {
  const API_BASE = '/api/cashier-tracking';

  function t(key, fallback) {
    return global.I18n?.t?.(key, fallback) || fallback;
  }

  function money(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return '$0.00';
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }

  function directionLabel(direction) {
    return direction === 'in' ? t('tracking.directionIn', 'In') : t('tracking.directionOut', 'Out');
  }

  function directionClass(direction) {
    return direction === 'in' ? 'audit-direction-in' : 'audit-direction-out';
  }

  function buildQuery(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    const query = search.toString();
    return query ? `?${query}` : '';
  }

  function renderSummaryStats(root, ledger, summary) {
    const grid = root.querySelector('[data-tracking-summary]');
    if (!grid) return;
    const stats = summary || {};
    grid.innerHTML = `
      <div class="stat-card tracking-stat-card">
        <h3>${money(ledger?.bookBalance)}</h3>
        <p data-i18n="tracking.centralBalance">${t('tracking.centralBalance', 'Central bank balance')}</p>
      </div>
      <div class="stat-card tracking-stat-card">
        <h3>${money(stats.totalIn)}</h3>
        <p data-i18n="tracking.totalIn">${t('tracking.totalIn', 'Total in')}</p>
      </div>
      <div class="stat-card tracking-stat-card">
        <h3>${money(stats.totalOut)}</h3>
        <p data-i18n="tracking.totalOut">${t('tracking.totalOut', 'Total out')}</p>
      </div>
      <div class="stat-card tracking-stat-card">
        <h3>${stats.count ?? 0}</h3>
        <p data-i18n="tracking.transactions">${t('tracking.transactions', 'Transactions')}</p>
      </div>
    `;
    global.I18n?.applyI18n?.(grid);
  }

  function renderLedgerTable(root, entries) {
    const tbody = root.querySelector('[data-tracking-ledger-body]');
    if (!tbody) return;
    const rows = entries || [];
    tbody.innerHTML = rows.length
      ? rows.map((entry) => `
        <tr>
          <td data-label="${escapeHtml(t('table.date', 'Date'))}">${escapeHtml(formatDate(entry.occurredAt))}</td>
          <td data-label="${escapeHtml(t('table.type', 'Type'))}">${escapeHtml(entry.typeLabel || entry.type)}</td>
          <td data-label="${escapeHtml(t('tracking.direction', 'Direction'))}">${escapeHtml(entry.direction)}</td>
          <td data-label="${escapeHtml(t('table.amount', 'Amount'))}">${money(entry.amount)}</td>
          <td data-label="${escapeHtml(t('tracking.balanceAfter', 'Balance after'))}">${money(entry.balanceAfter)}</td>
          <td data-label="${escapeHtml(t('table.notes', 'Notes'))}">${escapeHtml(entry.description || '—')}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="6">${escapeHtml(t('tracking.noLedger', 'No ledger activity yet.'))}</td></tr>`;
  }

  function renderPayoutList(root, payouts) {
    const list = root.querySelector('[data-tracking-payouts]');
    if (!list) return;
    const rows = payouts || [];
    list.innerHTML = rows.length
      ? rows.map((entry) => `
        <li>
          <span>${escapeHtml(entry.typeLabel || entry.type)}</span>
          <strong>${money(entry.amount)}</strong>
          <small>${escapeHtml(formatDate(entry.occurredAt))}</small>
        </li>
      `).join('')
      : `<li class="text-secondary">${escapeHtml(t('tracking.noPayouts', 'No recent payouts recorded.'))}</li>`;
  }

  function renderAuditRows(root, transactions, { append = false } = {}) {
    const tbody = root.querySelector('[data-tracking-audit-body]');
    if (!tbody) return;
    const rows = (transactions || []).map((tx) => `
      <tr>
        <td data-label="${escapeHtml(t('table.date', 'Date'))}">${escapeHtml(formatDate(tx.occurredAt))}</td>
        <td data-label="${escapeHtml(t('table.type', 'Type'))}">${escapeHtml(tx.categoryLabel || tx.category)}</td>
        <td data-label="${escapeHtml(t('tracking.direction', 'Direction'))}"><span class="${directionClass(tx.direction)}">${escapeHtml(directionLabel(tx.direction))}</span></td>
        <td data-label="${escapeHtml(t('table.amount', 'Amount'))}">${money(tx.amount)}</td>
        <td data-label="${escapeHtml(t('tracking.description', 'Description'))}">${escapeHtml(tx.description || '—')}</td>
        <td data-label="${escapeHtml(t('tracking.balanceAfter', 'Balance after'))}">${tx.balanceAfter != null ? money(tx.balanceAfter) : '—'}</td>
      </tr>
    `).join('');

    if (append) {
      tbody.insertAdjacentHTML('beforeend', rows);
    } else {
      tbody.innerHTML = rows || `<tr><td colspan="6">${escapeHtml(t('tracking.noAudit', 'No transactions matched your filters.'))}</td></tr>`;
    }
  }

  function showAlert(root, ledger) {
    const alertEl = root.querySelector('[data-tracking-alert]');
    if (!alertEl) return;
    if (ledger?.hasReconciliationAlert) {
      alertEl.classList.remove('hidden');
      alertEl.textContent = t(
        'tracking.reconciliationAlert',
        'The society bank ledger is under review. Book balance may differ from the physical bank until cashier reconciliation is complete.'
      );
    } else {
      alertEl.classList.add('hidden');
      alertEl.textContent = '';
    }
  }

  async function ensureCategories(root) {
    const select = root.querySelector('[data-tracking-category]');
    if (!select || select.dataset.loaded === '1') return;
    const response = await fetch(`${API_BASE}/categories`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load categories.');
    select.innerHTML = (data.categories || []).map((item) => (
      `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`
    )).join('');
    select.dataset.loaded = '1';
  }

  async function loadSummary(root) {
    const messageEl = root.querySelector('[data-tracking-message]');
    try {
      const response = await fetch(`${API_BASE}/summary`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load cashier tracking.');
      showAlert(root, data.ledger);
      renderPayoutList(root, data.recentPayouts);
      renderLedgerTable(root, data.recentActivity);
      if (messageEl) {
        messageEl.textContent = t('tracking.summaryUpdated', 'Live society cashier data.');
      }
      return data;
    } catch (error) {
      if (messageEl) messageEl.textContent = error.message;
      throw error;
    }
  }

  async function loadLedger(root) {
    const response = await fetch(`${API_BASE}/ledger?limit=50`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load ledger.');
    showAlert(root, data.ledger);
    renderLedgerTable(root, data.entries);
    return data;
  }

  async function loadAudit(root, state, { append = false } = {}) {
    const messageEl = root.querySelector('[data-tracking-message]');
    const loadMoreBtn = root.querySelector('[data-tracking-load-more]');
    const query = buildQuery({
      ...state.filters,
      limit: 50,
      offset: append ? state.offset : 0,
    });
    const response = await fetch(`${API_BASE}/audit${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load audit trail.');

    state.offset = append ? state.offset + (data.transactions || []).length : (data.transactions || []).length;
    state.hasMore = Boolean(data.hasMore);
    renderSummaryStats(root, data.ledger, data.summary);
    renderAuditRows(root, data.transactions, { append });
    if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;
    if (messageEl) {
      messageEl.textContent = `${data.totalMatched ?? 0} ${t('tracking.matched', 'transaction(s) matched.')}`;
    }
    return data;
  }

  function bindFilters(root, state) {
    const form = root.querySelector('[data-tracking-filter-form]');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.filters = {
        from: form.querySelector('[name="from"]')?.value || '',
        to: form.querySelector('[name="to"]')?.value || '',
        category: form.querySelector('[name="category"]')?.value || 'all',
      };
      state.offset = 0;
      try {
        await loadAudit(root, state, { append: false });
      } catch (error) {
        const messageEl = root.querySelector('[data-tracking-message]');
        if (messageEl) messageEl.textContent = error.message;
      }
    });

    const clearBtn = root.querySelector('[data-tracking-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        form.reset();
        state.filters = { from: '', to: '', category: 'all' };
        state.offset = 0;
        void loadAudit(root, state, { append: false });
      });
    }

    const loadMoreBtn = root.querySelector('[data-tracking-load-more]');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        void loadAudit(root, state, { append: true });
      });
    }
  }

  async function mount(root) {
    if (!root || root.dataset.trackingMounted === '1') return;
    root.dataset.trackingMounted = '1';
    const state = { filters: { from: '', to: '', category: 'all' }, offset: 0, hasMore: false };
    bindFilters(root, state);

    const tbody = root.querySelector('[data-tracking-audit-body]');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(t('common.loading', 'Loading…'))}</td></tr>`;

    try {
      await ensureCategories(root);
      await Promise.all([
        loadSummary(root),
        loadAudit(root, state, { append: false }),
      ]);
    } catch (error) {
      const messageEl = root.querySelector('[data-tracking-message]');
      if (messageEl) messageEl.textContent = error.message;
    }
  }

  function refresh(root) {
    if (!root) return Promise.resolve();
    root.dataset.trackingMounted = '';
    return mount(root);
  }

  global.SocietyCashierTracking = {
    mount,
    refresh,
    loadSummary,
    loadLedger,
    loadAudit,
  };
})(window);
