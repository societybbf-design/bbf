/**
 * Shared Approvals inbox renderer for CEO, Cashier, Employee, and Member dashboards.
 */
(function (global) {
  const STYLE_ID = 'approvals-inbox-styles';

  function t(key, fallback) {
    return global.I18n?.t?.(key, fallback) || fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .approvals-inbox-summary {
        display: flex; flex-wrap: wrap; gap: 0.65rem; margin: 0 0 1rem;
      }
      .approvals-inbox-pill {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.35rem 0.75rem; border-radius: 999px;
        background: color-mix(in srgb, var(--primary, #0f766e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary, #0f766e) 28%, transparent);
        font-size: 0.85rem; font-weight: 600;
      }
      .approvals-inbox-list { display: grid; gap: 0.85rem; }
      .approvals-inbox-item {
        border: 1px solid var(--border-color, #cbd5e1);
        border-radius: 12px;
        padding: 0.95rem 1rem;
        background: var(--card-bg, #fff);
      }
      .approvals-inbox-item.is-high {
        border-color: color-mix(in srgb, #d97706 45%, var(--border-color, #cbd5e1));
        box-shadow: inset 3px 0 0 #d97706;
      }
      .approvals-inbox-item-head {
        display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
        justify-content: space-between; align-items: flex-start;
        margin-bottom: 0.35rem;
      }
      .approvals-inbox-item-head h3 {
        margin: 0; font-size: 1.02rem; line-height: 1.3;
      }
      .approvals-inbox-meta {
        margin: 0; color: var(--text-secondary, #64748b); font-size: 0.9rem;
      }
      .approvals-inbox-amount {
        font-weight: 700; white-space: nowrap;
      }
      .approvals-inbox-actions {
        display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.85rem;
      }
      .approvals-inbox-actions .primary-btn,
      .approvals-inbox-actions .secondary-btn,
      .approvals-inbox-actions .ghost-btn {
        min-height: 2.25rem;
      }
      .approvals-inbox-details {
        margin-top: 0.75rem; padding-top: 0.75rem;
        border-top: 1px dashed var(--border-color, #cbd5e1);
        font-size: 0.9rem; color: var(--text-secondary, #64748b);
      }
      .approvals-inbox-details dl {
        display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0;
      }
      .approvals-inbox-details dt { font-weight: 600; color: var(--text-primary, #0f172a); }
      .approvals-inbox-details dd { margin: 0; }
      .approvals-inbox-empty {
        padding: 1.25rem 0.25rem; color: var(--text-secondary, #64748b);
      }
      .approvals-inbox-message { min-height: 1.25rem; margin-top: 0.75rem; }
      .nav-item .approvals-nav-badge {
        margin-left: auto; min-width: 1.35rem; height: 1.35rem;
        padding: 0 0.4rem; border-radius: 999px;
        background: #b45309; color: #fff;
        font-size: 0.72rem; font-weight: 700;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .nav-item .approvals-nav-badge.is-empty { display: none; }
    `;
    document.head.appendChild(style);
  }

  function formatWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function statusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('reject') || s.includes('cancel') || s.includes('fail')) return 'status-fail';
    if (s.includes('complete') || s.includes('verified') || s.includes('approved') || s.includes('process')) return 'status-completed';
    return 'status-pending';
  }

  function buttonClass(key) {
    if (key === 'approve' || key === 'complete') return 'primary-btn';
    if (key === 'reject') return 'secondary-btn';
    return 'ghost-btn';
  }

  function formatMoneyLocal(value) {
    if (value == null || value === '') return '';
    if (global.formatMoney) {
      try {
        return global.formatMoney(Number(value), 2);
      } catch (_) {
        // fall through
      }
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `৳${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function humanizeKey(key) {
    return String(key || '')
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  function pushDetailRow(rows, label, value) {
    if (value == null || value === '') return;
    if (typeof value === 'boolean') {
      rows.push([label, value ? 'Yes' : 'No']);
      return;
    }
    if (typeof value === 'object') return;
    rows.push([label, String(value)]);
  }

  function extractInvestmentDetails(data) {
    const rows = [];
    const investment = data?.investment || data || {};
    const tracking = data?.approvalTracking || investment.approvalTracking || null;

    pushDetailRow(rows, 'Project code', investment.investmentCode);
    pushDetailRow(rows, 'Type', investment.investmentType);
    pushDetailRow(rows, 'Status', String(investment.status || data?.status || '').replace(/_/g, ' '));
    if (investment.amount != null) pushDetailRow(rows, 'Total amount', formatMoneyLocal(investment.amount));
    if (investment.societyAmount != null) pushDetailRow(rows, 'Society share', formatMoneyLocal(investment.societyAmount));
    if (investment.externalAmount != null && Number(investment.externalAmount) > 0) {
      pushDetailRow(rows, 'External share', formatMoneyLocal(investment.externalAmount));
    }
    if (investment.societyOwnershipPct != null) {
      pushDetailRow(rows, 'Ownership', `Society ${investment.societyOwnershipPct}% / Investor ${investment.investorOwnershipPct || 0}%`);
    }
    pushDetailRow(rows, 'Return mode', investment.returnMode === 'monthly' ? 'Monthly return' : (investment.returnMode || ''));
    pushDetailRow(rows, 'Location', investment.location);
    pushDetailRow(rows, 'Sector', investment.sector);
    pushDetailRow(rows, 'Partner', investment.partner);

    const investor = investment.investor;
    if (investor && typeof investor === 'object') {
      pushDetailRow(rows, 'Investor', [investor.name, investor.email].filter(Boolean).join(' · '));
    } else {
      pushDetailRow(rows, 'Investor', investment.investorName);
    }

    const pm = investment.projectManager;
    if (pm && typeof pm === 'object') {
      pushDetailRow(rows, 'Project manager', [pm.name, pm.email].filter(Boolean).join(' · '));
    }

    if (tracking) {
      pushDetailRow(
        rows,
        'Member approvals',
        `${tracking.approvedCount || 0} / ${tracking.totalMembers || tracking.requiredApprovals || 0}`
      );
      if (Array.isArray(tracking.pendingMembers) && tracking.pendingMembers.length) {
        pushDetailRow(
          rows,
          'Awaiting',
          tracking.pendingMembers.map((m) => m.name || m.email || 'Member').join(', ')
        );
      }
      if (Array.isArray(tracking.approvedMembers) && tracking.approvedMembers.length) {
        pushDetailRow(
          rows,
          'Approved by',
          tracking.approvedMembers.map((m) => m.name || m.memberName || m.email || 'Member').join(', ')
        );
      }
    }

    if (investment.createdAt) pushDetailRow(rows, 'Created', formatWhen(investment.createdAt));
    return rows;
  }

  function extractLoanDetails(data) {
    const rows = [];
    const loan = data?.loan || data || {};
    pushDetailRow(rows, 'Member', loan.member?.name || loan.memberName);
    pushDetailRow(rows, 'Email', loan.member?.email || loan.email);
    pushDetailRow(rows, 'Loan type', loan.loanType);
    if (loan.amount != null) pushDetailRow(rows, 'Amount', formatMoneyLocal(loan.amount));
    pushDetailRow(rows, 'Purpose', loan.purpose);
    pushDetailRow(rows, 'Status', String(loan.status || '').replace(/_/g, ' '));
    pushDetailRow(rows, 'Payment method', loan.paymentMethod);
    if (loan.createdAt) pushDetailRow(rows, 'Created', formatWhen(loan.createdAt));
    return rows;
  }

  function extractGenericDetails(data, depth = 0) {
    const rows = [];
    if (!data || typeof data !== 'object' || depth > 1) return rows;

    Object.entries(data).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (['_id', 'id', '__v', 'password'].includes(key)) return;
      if (Array.isArray(value)) {
        if (!value.length) return;
        if (typeof value[0] !== 'object') {
          pushDetailRow(rows, humanizeKey(key), value.join(', '));
        } else if (value.length <= 8) {
          const summary = value
            .map((row) => row?.name || row?.memberName || row?.email || row?.investmentCode || '')
            .filter(Boolean)
            .join(', ');
          if (summary) pushDetailRow(rows, humanizeKey(key), summary);
        }
        return;
      }
      if (typeof value === 'object') {
        if (value.name || value.email) {
          pushDetailRow(rows, humanizeKey(key), [value.name, value.email].filter(Boolean).join(' · '));
        }
        return;
      }
      if (/(amount|balance|fee|price|settlement)/i.test(key) && Number.isFinite(Number(value))) {
        pushDetailRow(rows, humanizeKey(key), formatMoneyLocal(value));
        return;
      }
      if (/(date|At)$/i.test(key) || key === 'createdAt' || key === 'updatedAt') {
        pushDetailRow(rows, humanizeKey(key), formatWhen(value) || String(value));
        return;
      }
      pushDetailRow(rows, humanizeKey(key), value);
    });
    return rows;
  }

  function rowsFromApiPayload(data, item) {
    if (!data || typeof data !== 'object') return [];
    if (item?.type?.includes('investment') || data.investment || data.approvalTracking) {
      return extractInvestmentDetails(data);
    }
    if (item?.type?.includes('loan') || data.loan || data.loanType) {
      return extractLoanDetails(data);
    }
    return extractGenericDetails(data);
  }

  function mergeDetailRows(...groups) {
    const seen = new Set();
    const merged = [];
    groups.flat().forEach(([label, value]) => {
      const key = String(label).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push([label, value]);
    });
    return merged;
  }

  function detailsHtml(item, apiPayload = null) {
    const baseRows = [];
    if (item.status) baseRows.push(['Status', item.status.replace(/_/g, ' ')]);
    if (item.amountLabel) baseRows.push(['Amount', item.amountLabel]);
    if (item.createdAt) baseRows.push(['Created', formatWhen(item.createdAt)]);
    if (item.type) baseRows.push(['Type', item.type.replace(/_/g, ' ')]);
    Object.entries(item.details || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (typeof value === 'object') return;
      baseRows.push([humanizeKey(key), String(value)]);
    });

    const apiRows = rowsFromApiPayload(apiPayload, item);
    const rows = mergeDetailRows(baseRows, apiRows);

    if (!rows.length) {
      return `<p class="approvals-inbox-meta">${escapeHtml(t('approvals.noExtraDetails', 'No additional details.'))}</p>`;
    }
    return `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
  }

  function renderItem(item) {
    const actions = (item.actions || [])
      .filter((action) => !action.disabled)
      .map((action) => `
        <button
          type="button"
          class="${buttonClass(action.key)}"
          data-approvals-action="${escapeHtml(action.key)}"
          data-item-id="${escapeHtml(item.id)}"
        >${escapeHtml(action.label || action.key)}</button>
      `)
      .join('');

    return `
      <article class="approvals-inbox-item${item.priority === 'high' ? ' is-high' : ''}" data-approvals-item="${escapeHtml(item.id)}">
        <div class="approvals-inbox-item-head">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="approvals-inbox-meta">${escapeHtml(item.subtitle || '')}</p>
          </div>
          <div style="text-align:right">
            ${item.amountLabel ? `<div class="approvals-inbox-amount">${escapeHtml(item.amountLabel)}</div>` : ''}
            ${item.status ? `<span class="status-badge ${statusClass(item.status)}">${escapeHtml(String(item.status).replace(/_/g, ' '))}</span>` : ''}
          </div>
        </div>
        ${item.createdAt ? `<p class="approvals-inbox-meta">${escapeHtml(formatWhen(item.createdAt))}</p>` : ''}
        <div class="approvals-inbox-actions">${actions}</div>
        <div class="approvals-inbox-details hidden" data-approvals-details></div>
      </article>
    `;
  }

  function renderInbox(container, payload, options = {}) {
    ensureStyles();
    const items = payload?.items || [];
    const summary = payload?.summary || { total: items.length, highPriority: 0 };

    if (!items.length) {
      container.innerHTML = `
        <div class="approvals-inbox-empty">${escapeHtml(options.emptyMessage || t('approvals.empty', 'No pending approvals right now.'))}</div>
        <p class="message approvals-inbox-message" data-approvals-message></p>
      `;
      return;
    }

    container.innerHTML = `
      <div class="approvals-inbox-summary">
        <span class="approvals-inbox-pill"><strong>${summary.total}</strong> ${escapeHtml(t('approvals.pending', 'pending'))}</span>
        ${summary.highPriority ? `<span class="approvals-inbox-pill"><strong>${summary.highPriority}</strong> ${escapeHtml(t('approvals.highPriority', 'high priority'))}</span>` : ''}
      </div>
      <div class="approvals-inbox-list">
        ${items.map(renderItem).join('')}
      </div>
      <p class="message approvals-inbox-message" data-approvals-message></p>
    `;
  }

  function setMessage(container, text, isError = false) {
    const el = container.querySelector('[data-approvals-message]');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', Boolean(isError));
  }

  async function executeAction(action, item) {
    if (!action?.path || !action?.method) {
      throw new Error(t('approvals.actionUnavailable', 'This action is not available.'));
    }
    const method = String(action.method).toUpperCase();
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = JSON.stringify(action.body || {});
    }
    const response = await fetch(action.path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || t('approvals.actionFailed', 'Unable to complete this approval action.'));
    }
    return data;
  }

  function navigateDeepLink(item, options = {}) {
    const hash = item?.deepLink?.hash;
    if (!hash) return false;
    if (typeof options.onNavigate === 'function') {
      options.onNavigate(hash.replace(/^#/, ''));
      return true;
    }
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    return true;
  }

  function bindActions(container, items, options = {}) {
    const byId = new Map((items || []).map((row) => [row.id, row]));
    container.querySelectorAll('[data-approvals-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = byId.get(btn.dataset.itemId);
        if (!item) return;
        const action = (item.actions || []).find((row) => row.key === btn.dataset.approvalsAction);
        if (!action) return;

        if (action.key === 'view') {
          const details = btn.closest('[data-approvals-item]')?.querySelector('[data-approvals-details]');
          if (details) {
            const opening = details.classList.contains('hidden');
            details.classList.toggle('hidden', !opening);
            if (!opening) return;
            details.innerHTML = `<p class="approvals-inbox-meta">${escapeHtml(t('common.loading', 'Loading…'))}</p>`;
          }
          if (action.path && action.method === 'GET') {
            try {
              const response = await fetch(action.path);
              const data = await response.json().catch(() => ({}));
              if (response.ok && details) {
                details.classList.remove('hidden');
                details.innerHTML = detailsHtml(item, data);
              } else if (details) {
                details.classList.remove('hidden');
                details.innerHTML = detailsHtml(item);
                if (!response.ok && data.error) {
                  details.innerHTML += `<p class="message error" style="margin-top:.5rem">${escapeHtml(data.error)}</p>`;
                }
              }
            } catch {
              if (details) {
                details.classList.remove('hidden');
                details.innerHTML = detailsHtml(item);
              }
            }
          } else if (details) {
            details.innerHTML = detailsHtml(item);
          }
          return;
        }

        const isInvestmentCashierComplete = action.key === 'complete'
          && String(action.path || '').includes('/api/admin/investments/')
          && String(action.path || '').includes('/cashier-complete');

        if (isInvestmentCashierComplete && typeof window.beginCashierCompletePayment === 'function') {
          const investmentId = String(action.path).split('/')[4];
          btn.disabled = true;
          setMessage(container, t('approvals.working', 'Opening payment popup…'));
          try {
            const result = await new Promise((resolve, reject) => {
              window.beginCashierCompletePayment(investmentId, {
                messageEl: document.getElementById('cashierQueueMessage'),
                onDone: (done) => resolve(done || { completed: false, cancelled: true }),
              }).catch(reject);
            });
            if (result?.completed) {
              setMessage(container, t('approvals.actionSuccess', 'Payment completed.'));
              if (typeof options.onActionComplete === 'function') {
                await options.onActionComplete(action, item);
              } else {
                await loadAndRender(container.id || container.getAttribute('id'), options);
              }
            } else {
              setMessage(
                container,
                result?.openLedger
                  ? t('approvals.openLedgerHint', 'Set the bank opening balance in Bank Ledger, then try Complete payment again.')
                  : t('approvals.paymentPendingFix', 'Payment popup closed. Fix any shortfall and try Complete payment again.')
              );
              btn.disabled = false;
            }
          } catch (error) {
            setMessage(container, error.message || t('approvals.actionFailed', 'Unable to complete this approval action.'), true);
            btn.disabled = false;
          }
          return;
        }

        const confirmLabel = action.key === 'reject'
          ? t('approvals.confirmReject', 'Reject this request?')
          : t('approvals.confirmAccept', 'Accept this request?');
        if (!window.confirm(confirmLabel)) return;

        btn.disabled = true;
        setMessage(container, t('approvals.working', 'Working…'));
        try {
          await executeAction(action, item);
          setMessage(container, t('approvals.actionSuccess', 'Action completed.'));
          if (typeof options.onActionComplete === 'function') {
            await options.onActionComplete(action, item);
          } else {
            await loadAndRender(container.id || container.getAttribute('id'), options);
          }
        } catch (error) {
          setMessage(container, error.message || t('approvals.actionFailed', 'Unable to complete this approval action.'), true);
          btn.disabled = false;
        }
      });
    });
  }

  async function loadAndRender(containerOrId, options = {}) {
    ensureStyles();
    const container = typeof containerOrId === 'string'
      ? document.getElementById(containerOrId)
      : containerOrId;
    if (!container) return null;

    container.innerHTML = `<p class="approvals-inbox-empty">${escapeHtml(t('common.loading', 'Loading…'))}</p>`;
    try {
      const response = await fetch('/api/approvals/inbox');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('approvals.loadFailed', 'Unable to load approvals.'));
      }
      renderInbox(container, data, options);
      bindActions(container, data.items || [], {
        ...options,
        onActionComplete: async (...args) => {
          if (typeof options.onActionComplete === 'function') {
            await options.onActionComplete(...args);
          }
          await loadAndRender(container, options);
          if (options.badgeSelector) {
            await refreshBadge(options.badgeSelector);
          }
        },
      });
      if (options.badgeSelector) {
        await refreshBadge(options.badgeSelector, data.summary?.total);
      }
      return data;
    } catch (error) {
      container.innerHTML = `<p class="message error">${escapeHtml(error.message || t('approvals.loadFailed', 'Unable to load approvals.'))}</p>`;
      return null;
    }
  }

  async function refreshBadge(selector, knownTotal = null) {
    ensureStyles();
    const nodes = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector].filter(Boolean);
    if (!nodes.length) return 0;

    let total = knownTotal;
    if (total == null) {
      try {
        const response = await fetch('/api/approvals/counts');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return 0;
        total = Number(data.total || 0);
      } catch {
        return 0;
      }
    }

    nodes.forEach((node) => {
      let badge = node.querySelector('.approvals-nav-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'approvals-nav-badge';
        badge.setAttribute('aria-label', t('approvals.pending', 'pending'));
        node.appendChild(badge);
      }
      badge.textContent = String(total);
      badge.classList.toggle('is-empty', !total);
    });
    return total;
  }

  global.ApprovalsInbox = {
    loadAndRender,
    refreshBadge,
    navigateDeepLink,
  };
})(window);
