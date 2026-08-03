function t(key, fallback) {
  return window.I18n?.t?.(key, fallback) ?? fallback;
}

function statusLabel(value) {
  const key = String(value || '').toLowerCase();
  const map = {
    active: 'status.active', inactive: 'status.inactive', blocked: 'status.blocked',
    deleted: 'status.deleted', pending: 'status.pending',
  };
  return map[key] ? t(map[key], value) : (value || '—');
}

/**
 * developer.js — User Management dashboard UI
 *
 * Dedicated dashboard: views/user-management.html
 * CEO may open the same focused page via /user-management (no CEO finance chrome).
 *
 * APIs: /api/developer/*
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyFmt(value) {
  if (window.formatMoney) return window.formatMoney(Number(value || 0), 2);
  return `৳${Number(value || 0).toFixed(2)}`;
}

/* Soft-delete / deletion settlement UI removed — use active / inactive / blocked. */

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

const TAB_TITLE_KEYS = {
  overview: ['um.overview', 'Overview', 'um.focusedNote', 'Account lifecycle and security only — finance modules stay on the CEO dashboard.'],
  create: ['um.createAccount', 'Create Account', 'um.createSubtitle', 'Exclusive path for members, investors, external investors, project managers, cashiers, employees, and CEOs.'],
  users: ['um.allAccounts', 'All Accounts', 'um.directoryNote', 'Browse accounts by role. Accounts stay active, inactive, or blocked — never deleted.'],
  recovery: ['um.otpRecovery', 'OTP Recovery', 'um.otpNote', 'When a locked or forgotten-password user shares their OTP, select their account, enter the OTP, and set a new password.'],
  audits: ['um.securityAudit', 'Security Audit', 'um.auditNote', 'Login failures, lockouts, OTP requests, password changes, and email updates.'],
  approvals: ['Member Approvals', 'Member Approvals', 'um.approvalsNote', 'Track member votes and record proxy approvals for absent members. CEO and Cashier steps are not changed.'],
  security: ['um.mySecurity', 'My Security', 'um.changePasswordTitle', 'Change my password'],
};

const ROLE_DIRECTORY = [
  { id: 'member', labelKey: 'um.members', label: 'Members', roles: ['member'] },
  { id: 'investor', labelKey: 'um.investors', label: 'Investors', roles: ['investor'] },
  { id: 'external_investor', labelKey: 'um.externalInvestors', label: 'External Investors', roles: ['external_investor'] },
  { id: 'ceo', labelKey: 'um.ceos', label: 'CEOs', roles: ['ceo', 'admin'] },
  { id: 'project_manager', labelKey: 'um.managers', label: 'Managers', roles: ['project_manager'] },
  { id: 'cashier', labelKey: 'um.cashiers', label: 'Cashiers', roles: ['cashier'] },
  { id: 'employee', labelKey: 'um.employees', label: 'Employees', roles: ['employee'] },
  { id: 'developer', labelKey: 'um.umAdmins', label: 'UM Admins', roles: ['developer'] },
];

function roleLabel(entry) {
  return t(entry.labelKey || '', entry.label || entry.id);
}

function tabTitles(tab) {
  const keys = TAB_TITLE_KEYS[tab] || TAB_TITLE_KEYS.overview;
  return [t(keys[0], keys[1] || tab), t(keys[2], keys[3] || '')];
}

let cachedUsers = [];
let activeRoleTab = 'member';
let selectedUserId = null;
let developerUiBound = false;
let developerSessionUser = null;
let umMeta = { roles: [], permissions: [] };
let umCreateReady = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

function showTab(tab) {
  document.querySelectorAll('[data-dev-tab]').forEach((el) => {
    el.classList.toggle('active', el.dataset.devTab === tab);
  });
  document.querySelectorAll('[data-dev-panel]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.devPanel !== tab);
  });

  const titles = tabTitles(tab);
  const pageTitle = document.getElementById('pageTitle');
  const pageNote = document.getElementById('pageNote');
  if (pageTitle) pageTitle.textContent = titles[0];
  if (pageNote) pageNote.textContent = titles[1];

  if (tab === 'users') loadUsers();
  if (tab === 'create') void ensureCreateForm();
  if (tab === 'recovery') loadRecoveryOptions();
  if (tab === 'audits') loadAudits();
  if (tab === 'approvals') loadMemberApprovalTracking();
  if (tab === 'overview') loadStats();
}

function canProxyMemberApprovals() {
  if (!developerSessionUser) return false;
  if (developerSessionUser.role === 'developer') return true;
  return (developerSessionUser.permissions || []).includes('can_proxy_member_approvals');
}

function workflowTypeLabel(type) {
  return type === 'investment' ? 'Project' : 'Member exit';
}

function statusLabelForWorkflow(status) {
  const map = {
    pending_member_approval: 'Awaiting member votes',
    pending_departing_approval: 'Awaiting departing member',
    pending_cashier_payment: 'With Cashier (payment)',
  };
  return map[status] || status || '—';
}

function renderApprovalMemberRows(approved = [], pending = [], { canProxy = false, workflowType = '', entityId = '' } = {}) {
  const approvedHtml = approved.length
    ? `<div class="u-mb-1"><strong>Approved (${approved.length})</strong><ul class="um-approval-list">${approved.map((row) => `
      <li>
        ${escapeHtml(row.memberName || 'Member')}
        <span class="table-subtitle">${escapeHtml(row.memberEmail || '')}</span>
        ${row.isProxied ? `<span class="kpi-footnote"> · Proxy by ${escapeHtml(row.proxiedByName || 'UM')} (${escapeHtml(row.proxyReason || '')})</span>` : ''}
      </li>`).join('')}</ul></div>`
    : '';

  const pendingHtml = pending.length
    ? `<div><strong>Pending (${pending.length})</strong><ul class="um-approval-list">${pending.map((row) => `
      <li class="um-approval-pending-row">
        <span>
          ${escapeHtml(row.memberName || 'Member')}
          <span class="table-subtitle">${escapeHtml(row.memberEmail || '')} · ${escapeHtml(row.stepLabel || row.step || '')}</span>
        </span>
        ${canProxy ? `<button type="button" class="secondary-btn um-proxy-btn"
          data-proxy-workflow="${escapeHtml(workflowType)}"
          data-proxy-entity="${escapeHtml(entityId)}"
          data-proxy-member="${escapeHtml(row.memberId)}"
          data-proxy-label="${escapeHtml(row.memberName || 'Member')}">Approve on behalf</button>` : ''}
      </li>`).join('')}</ul></div>`
    : '<p class="table-subtitle">No pending member votes.</p>';

  return `${approvedHtml}${pendingHtml}`;
}

async function loadMemberApprovalTracking() {
  const summaryEl = document.getElementById('umApprovalSummary');
  const listEl = document.getElementById('umApprovalTrackingList');
  const msgEl = document.getElementById('umApprovalMessage');
  if (!listEl) return;
  if (msgEl) msgEl.textContent = '';

  try {
    const data = await api('/api/developer/member-approvals/pending');
    const summary = data.summary || {};
    const items = data.items || [];
    const canProxy = canProxyMemberApprovals();

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Open workflows</span><strong class="metric-value">${summary.openWorkflows || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Pending member votes</span><strong class="metric-value">${summary.pendingVotes || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Projects</span><strong class="metric-value">${summary.investmentCount || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Exit requests</span><strong class="metric-value">${summary.exitCount || 0}</strong></div></div>
      `;
    }

    if (!items.length) {
      listEl.innerHTML = '<p class="table-subtitle">No workflows are waiting for member-level approval.</p>';
      return;
    }

    listEl.innerHTML = items.map((item) => `
      <article class="panel-card u-mb-1 um-approval-card" data-workflow-id="${escapeHtml(item.entityId)}">
        <div class="um-approval-card-header">
          <div>
            <p class="um-modal-eyebrow">${escapeHtml(workflowTypeLabel(item.workflowType))}</p>
            <h3>${escapeHtml(item.label || 'Workflow')}</h3>
            <p class="table-subtitle">${escapeHtml(statusLabelForWorkflow(item.status))} · Started ${escapeHtml(formatDate(item.createdAt))}</p>
          </div>
        </div>
        ${renderApprovalMemberRows(item.approvedApprovals || [], item.pendingApprovals || [], {
          canProxy,
          workflowType: item.workflowType,
          entityId: item.entityId,
        })}
      </article>
    `).join('');

    if (!canProxy) {
      listEl.insertAdjacentHTML('beforeend', '<p class="table-subtitle u-mt-1">You can view tracking here. Only User Management admins with proxy permission can approve on behalf of absent members.</p>');
    }

    listEl.querySelectorAll('.um-proxy-btn').forEach((btn) => {
      btn.addEventListener('click', () => openProxyApprovalModal({
        workflowType: btn.dataset.proxyWorkflow,
        entityId: btn.dataset.proxyEntity,
        memberId: btn.dataset.proxyMember,
        memberLabel: btn.dataset.proxyLabel,
        workflowLabel: btn.closest('.um-approval-card')?.querySelector('h3')?.textContent || 'Workflow',
      }));
    });
  } catch (error) {
    listEl.innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

function openProxyApprovalModal({ workflowType, entityId, memberId, memberLabel, workflowLabel }) {
  const modal = document.getElementById('umProxyApprovalModal');
  const subtitle = document.getElementById('umProxyApprovalSubtitle');
  const form = document.getElementById('umProxyApprovalForm');
  if (!modal || !form) return;

  document.getElementById('umProxyWorkflowType').value = workflowType || '';
  document.getElementById('umProxyEntityId').value = entityId || '';
  document.getElementById('umProxyMemberId').value = memberId || '';
  if (subtitle) {
    subtitle.textContent = `Record approval for ${memberLabel || 'member'} on ${workflowLabel || 'workflow'}.`;
  }
  const msg = document.getElementById('umProxyFormMessage');
  if (msg) msg.textContent = '';
  form.reset();
  document.getElementById('umProxyWorkflowType').value = workflowType || '';
  document.getElementById('umProxyEntityId').value = entityId || '';
  document.getElementById('umProxyMemberId').value = memberId || '';
  modal.classList.remove('hidden');
}

function closeProxyApprovalModal() {
  document.getElementById('umProxyApprovalModal')?.classList.add('hidden');
}

function umBlockedPermissionsForRole(role) {
  if (role === 'cashier') return new Set();
  if (role === 'project_manager') {
    return new Set(umMeta.projectManagerBlockedPermissions || umMeta.cashierExclusivePermissions || []);
  }
  if (role === 'member') {
    return new Set((umMeta.permissions || []).map((p) => p.key));
  }
  return new Set(umMeta.cashierExclusivePermissions || []);
}

function renderUmPermissions(selectedKeys = []) {
  const grid = document.getElementById('devPermissionsGrid');
  if (!grid) return;
  const role = document.getElementById('devRoleSelect')?.value || '';
  const blocked = umBlockedPermissionsForRole(role);
  const selected = new Set((selectedKeys || []).filter((key) => !blocked.has(key)));
  grid.innerHTML = (umMeta.permissions || []).map((perm) => {
    const isBlocked = blocked.has(perm.key);
    return `
    <label class="permission-chip${isBlocked ? ' is-disabled' : ''}" title="${isBlocked ? 'Not available for this role' : ''}">
      <input type="checkbox" value="${escapeHtml(perm.key)}" ${selected.has(perm.key) ? 'checked' : ''} ${isBlocked ? 'disabled' : ''} />
      <span>
        <strong>${escapeHtml(perm.label)}</strong>
        <small>${escapeHtml(isBlocked ? `${perm.description || ''} (blocked for ${role.replace(/_/g, ' ')})` : (perm.description || ''))}</small>
      </span>
    </label>
  `;
  }).join('');
}

function applyUmRoleDefaults() {
  const role = document.getElementById('devRoleSelect')?.value;
  const match = (umMeta.roles || []).find((r) => r.value === role);
  renderUmPermissions(match?.defaultPermissions || []);
}

function getUmSelectedPermissions() {
  return Array.from(document.querySelectorAll('#devPermissionsGrid input[type="checkbox"]:checked:not(:disabled)'))
    .map((el) => el.value);
}

async function ensureCreateForm() {
  const roleSelect = document.getElementById('devRoleSelect');
  const form = document.getElementById('devCreateUserForm');
  if (!roleSelect || !form) return;

  if (!umCreateReady) {
    const data = await api('/api/developer/meta');
    umMeta = data;
    roleSelect.innerHTML = (umMeta.roles || []).map((role) => (
      `<option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>`
    )).join('');
    applyUmRoleDefaults();
    roleSelect.addEventListener('change', applyUmRoleDefaults);
    document.getElementById('devSelectAllPerms')?.addEventListener('click', () => {
      const role = document.getElementById('devRoleSelect')?.value || '';
      const blocked = umBlockedPermissionsForRole(role);
      renderUmPermissions(
        (umMeta.permissions || []).map((p) => p.key).filter((key) => !blocked.has(key))
      );
    });
    document.getElementById('devClearPerms')?.addEventListener('click', () => {
      renderUmPermissions([]);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageEl = document.getElementById('devCreateMessage');
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }
      const formData = new FormData(form);
      const role = formData.get('role');
      const payload = {
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        role,
        permissions: getUmSelectedPermissions(),
      };
      try {
        const result = await api('/api/developer/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (messageEl) {
          messageEl.textContent = result.message || t('um.accountCreated', 'Account created.');
          messageEl.classList.add('success');
        }
        form.reset();
        applyUmRoleDefaults();
        await loadUsers();
        await loadStats();
      } catch (error) {
        if (messageEl) {
          messageEl.textContent = error.message;
          messageEl.classList.add('error');
        }
      }
    });

    umCreateReady = true;
  }
}

async function loadStats() {
  const grid = document.getElementById('devStatsGrid');
  if (!grid) return;
  const { stats } = await api('/api/developer/stats');
  const cards = [
    ['Total accounts', stats.total],
    ['Active', stats.active],
    ['Inactive', stats.inactive],
    ['Blocked', stats.blocked],
    ['Temporarily locked', stats.locked],
    ['Pending OTP', stats.pendingOtp],
  ];
  grid.innerHTML = cards.map(([label, value]) => `
    <article class="stat-card">
      <p class="small-label">${escapeHtml(label)}</p>
      <h3>${escapeHtml(value)}</h3>
    </article>
  `).join('');
}

async function loadUsers() {
  const q = document.getElementById('userSearch')?.value.trim() || '';
  const status = document.getElementById('userStatusFilter')?.value || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);

  const message = document.getElementById('devUsersMessage');
  if (message) message.textContent = '';
  try {
    const data = await api(`/api/developer/users?${params.toString()}`);
    cachedUsers = data.users || [];
    updateRoleTabCounts();
    renderActiveRoleDirectory();
    loadRecoveryOptions();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

function getRoleDirectoryEntry(tabId = activeRoleTab) {
  return ROLE_DIRECTORY.find((entry) => entry.id === tabId) || ROLE_DIRECTORY[0];
}

function usersForRoleTab(tabId = activeRoleTab) {
  const entry = getRoleDirectoryEntry(tabId);
  const roles = new Set(entry.roles);
  return cachedUsers.filter((user) => roles.has(user.role));
}

function updateRoleTabCounts() {
  ROLE_DIRECTORY.forEach((entry) => {
    const count = usersForRoleTab(entry.id).length;
    const badge = document.querySelector(`[data-um-role-count="${entry.id}"]`);
    if (badge) badge.textContent = String(count);
  });
}

function setActiveRoleTab(tabId) {
  const entry = getRoleDirectoryEntry(tabId);
  activeRoleTab = entry.id;

  document.querySelectorAll('[data-um-role-tab]').forEach((btn) => {
    const isActive = btn.dataset.umRoleTab === activeRoleTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const label = document.getElementById('umRolePanelLabel');
  if (label) label.textContent = t('um.showingRole', 'Showing {label}').replace('{label}', roleLabel(entry));

  renderActiveRoleDirectory();
}

function renderActiveRoleDirectory() {
  renderUsersTable(usersForRoleTab(activeRoleTab));
}

function lockBadge(user) {
  if (user.isTemporarilyLocked) return `<span class="status-pill">${t('um.locked24h', 'Locked 24h')}</span>`;
  if (user.hasPendingOtp) return `<span class="status-pill">${t('um.otpPending', 'OTP pending')}</span>`;
  if (user.failedLoginAttempts) return `${user.failedLoginAttempts} ${t('um.fails', 'fails')}`;
  return '—';
}

function renderUsersTable(users) {
  const tbody = document.getElementById('devUsersTable');
  if (!tbody) return;
  const entry = getRoleDirectoryEntry();
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6">${t('um.noUsers', 'No accounts found.')} (${escapeHtml(roleLabel(entry))})</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.roleLabel || user.role)}</td>
      <td>${escapeHtml(statusLabel(user.status))}</td>
      <td>${lockBadge(user)}</td>
      <td>
        <button type="button" class="ghost-btn" data-manage-user="${user.id || user._id}">${t('um.manageUser', 'Manage')}</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-manage-user]').forEach((btn) => {
    btn.addEventListener('click', () => openUserModal(btn.dataset.manageUser));
  });
}

function openUserModal(userId) {
  const user = cachedUsers.find((u) => String(u.id || u._id) === String(userId));
  if (!user) return;
  selectedUserId = String(user.id || user._id);
  const modal = document.getElementById('devUserModal');
  if (!modal) return;

  const displayName = user.name || 'Unknown user';
  const displayEmail = user.email || '—';
  const roleLabel = user.roleLabel || user.role || '—';

  const titleEl = document.getElementById('devUserModalTitle');
  const emailEl = document.getElementById('devUserModalEmail');
  const metaEl = document.getElementById('devUserModalMeta');
  const eyebrowEl = document.getElementById('devUserModalEyebrow');
  if (eyebrowEl) eyebrowEl.textContent = t('um.updatingProfileFor', 'Updating profile for');
  if (titleEl) titleEl.textContent = displayName;
  if (emailEl) emailEl.textContent = displayEmail;
  if (metaEl) metaEl.textContent = `${roleLabel} · ${t('table.status', 'Status')}: ${statusLabel(user.status)}`;

  document.getElementById('devUserModalBody').innerHTML = `
    <div class="um-modal-subject" aria-live="polite">
      <p class="um-modal-subject-line">You are managing <strong>${escapeHtml(displayName)}</strong></p>
      <p class="um-modal-subject-email">${escapeHtml(displayEmail)}</p>
    </div>
    <p class="small-label">Failed logins: ${user.failedLoginAttempts || 0} · Lock until: ${formatDate(user.lockUntil)} · Last login: ${formatDate(user.lastLoginAt)}</p>
    <form id="devEmailForm" class="add-member-form u-mt-1">
      <h3>Update email</h3>
      <div class="form-group">
        <label>
          New email
          <input type="email" name="email" value="${escapeHtml(user.email)}" required />
        </label>
      </div>
      <button type="submit" class="primary-btn">Save email</button>
    </form>

    <form id="devPasswordForm" class="add-member-form u-mt-1">
      <h3>Set password directly</h3>
      <div class="form-group">
        <label>
          New password
          <input type="password" name="password" minlength="6" required />
        </label>
      </div>
      <button type="submit" class="primary-btn">Set password</button>
    </form>

    <div class="ceo-dev-status-actions">
      <button type="button" class="primary-btn" data-status="active">Activate</button>
      <button type="button" class="ghost-btn" data-status="inactive">Deactivate</button>
      <button type="button" class="ghost-btn" data-status="blocked">Block</button>
      <button type="button" class="ghost-btn" data-action="unlock">${t('um.clearLockout', 'Clear lockout')}</button>
    </div>
    <p id="devModalMessage" class="message"></p>
  `;

  modal.classList.remove('hidden');

  document.getElementById('devEmailForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('devModalMessage');
    try {
      const email = new FormData(event.target).get('email');
      await api(`/api/developer/users/${selectedUserId}/email`, {
        method: 'PATCH',
        body: JSON.stringify({ email }),
      });
      msg.textContent = 'Email updated. Profile and financial data unchanged.';
      await loadUsers();
      const refreshed = cachedUsers.find((u) => String(u.id || u._id) === selectedUserId);
      if (refreshed) {
        const emailNode = document.getElementById('devUserModalEmail');
        const subjectEmail = document.querySelector('.um-modal-subject-email');
        if (emailNode) emailNode.textContent = refreshed.email;
        if (subjectEmail) subjectEmail.textContent = refreshed.email;
      }
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.getElementById('devPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('devModalMessage');
    try {
      const password = new FormData(event.target).get('password');
      await api(`/api/developer/users/${selectedUserId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      msg.textContent = t('um.passwordUpdated', 'Password updated.');
      event.target.reset();
      await loadUsers();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.querySelectorAll('#devUserModalBody [data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msg = document.getElementById('devModalMessage');
      try {
        await api(`/api/developer/users/${selectedUserId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: btn.dataset.status }),
        });
        msg.textContent = `Status set to ${btn.dataset.status}.` + (btn.dataset.status !== 'active' ? ' Active sessions were revoked.' : '');
        await loadUsers();
        const refreshed = cachedUsers.find((u) => String(u.id || u._id) === selectedUserId);
        const metaNode = document.getElementById('devUserModalMeta');
        if (refreshed && metaNode) {
          metaNode.textContent = `${refreshed.roleLabel || refreshed.role} · Status: ${refreshed.status}`;
        }
      } catch (error) {
        msg.textContent = error.message;
      }
    });
  });

  document.querySelector('#devUserModalBody [data-action="unlock"]')?.addEventListener('click', async () => {
    const msg = document.getElementById('devModalMessage');
    try {
      await api(`/api/developer/users/${selectedUserId}/unlock`, { method: 'POST', body: '{}' });
      msg.textContent = t('um.clearLockout', 'Temporary lockout cleared.');
      await loadUsers();
    } catch (error) {
      msg.textContent = error.message;
    }
  });


}

function loadRecoveryOptions() {
  const select = document.getElementById('otpUserSelect');
  if (!select) return;
  const pending = cachedUsers.filter((u) => u.hasPendingOtp);
  const options = (pending.length ? pending : cachedUsers.filter((u) => ['active', 'inactive', 'blocked'].includes(u.status))).map((u) => `
    <option value="${escapeHtml(u.id || u._id)}">
      ${escapeHtml(u.name)} (${escapeHtml(u.email)})${u.hasPendingOtp ? ' · OTP pending' : ''}
    </option>
  `).join('');
  select.innerHTML = `<option value="">${t('um.selectPendingOtp', 'Select user…')}</option>${options}`;
}

async function loadAudits() {
  const tbody = document.getElementById('devAuditsTable');
  if (!tbody) return;
  const { audits } = await api('/api/developer/audits?limit=100');
  if (!audits?.length) {
    tbody.innerHTML = `<tr><td colspan="5">${t('common.noRecords', 'No audit events yet.')}</td></tr>`;
    return;
  }
  tbody.innerHTML = audits.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.createdAt))}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.actorEmail || '—')} ${row.actorRole ? `(${escapeHtml(row.actorRole)})` : ''}</td>
      <td>${escapeHtml(row.targetEmail || '—')}</td>
      <td>${row.success === false ? 'Failed' : 'OK'}</td>
    </tr>
  `).join('');
}

function bindUi() {
  if (developerUiBound) return;
  developerUiBound = true;

  document.querySelectorAll('[data-dev-tab]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      showTab(el.dataset.devTab);
    });
  });

  document.getElementById('refreshUsersBtn')?.addEventListener('click', loadUsers);
  document.getElementById('userSearch')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadUsers();
    }
  });
  document.getElementById('userStatusFilter')?.addEventListener('change', loadUsers);
  document.querySelectorAll('[data-um-role-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveRoleTab(btn.dataset.umRoleTab));
  });

  document.getElementById('closeDevUserModal')?.addEventListener('click', () => {
    document.getElementById('devUserModal')?.classList.add('hidden');
  });

  document.getElementById('closeUmProxyModal')?.addEventListener('click', closeProxyApprovalModal);
  document.getElementById('umProxyApprovalModal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'umProxyApprovalModal') closeProxyApprovalModal();
  });

  document.getElementById('umProxyApprovalForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('umProxyFormMessage');
    if (msg) msg.textContent = '';
    const formData = new FormData(event.target);
    const workflowType = formData.get('workflowType');
    const entityId = formData.get('entityId');
    const memberId = formData.get('memberId');
    const payload = {
      memberId,
      reason: formData.get('reason'),
      confirmPassword: formData.get('confirmPassword'),
    };

    const path = workflowType === 'investment'
      ? `/api/developer/member-approvals/investments/${encodeURIComponent(entityId)}/proxy`
      : `/api/developer/member-approvals/exits/${encodeURIComponent(entityId)}/proxy`;

    try {
      const result = await api(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (msg) msg.textContent = result.message || 'Proxy approval recorded.';
      closeProxyApprovalModal();
      const banner = document.getElementById('umApprovalMessage');
      if (banner) banner.textContent = result.message || 'Proxy approval recorded.';
      await loadMemberApprovalTracking();
    } catch (error) {
      if (msg) msg.textContent = error.message;
    }
  });

  document.getElementById('otpResetForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('otpResetMessage');
    const formData = new FormData(event.target);
    try {
      await api(`/api/developer/users/${formData.get('userId')}/otp-reset`, {
        method: 'POST',
        body: JSON.stringify({
          otp: formData.get('otp'),
          newPassword: formData.get('newPassword'),
        }),
      });
      msg.textContent = t('um.otpVerified', 'OTP verified. New password set and account unlocked.');
      event.target.reset();
      await loadUsers();
      await loadAudits();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.getElementById('devSelfPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('devSelfPasswordMessage');
    const formData = new FormData(event.target);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: formData.get('currentPassword'),
          newPassword: formData.get('newPassword'),
        }),
        skipPasswordConfirm: true,
      });
      msg.textContent = t('um.passwordUpdated', 'Password updated.');
      event.target.reset();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

async function initDeveloperControls() {
  let sessionUser = null;
  try {
    const session = await api('/api/session');
    sessionUser = session.user || null;
    developerSessionUser = sessionUser;
    if (!developerSessionUser || !['developer', 'ceo', 'admin'].includes(developerSessionUser.role)) {
      window.location.href = session.user?.redirectTo || '/';
      return;
    }

    const nameEl = document.getElementById('umSidebarName');
    const initialEl = document.getElementById('umSidebarInitial');
    if (nameEl) nameEl.textContent = developerSessionUser.name || 'User Management';
    if (initialEl) initialEl.textContent = (developerSessionUser.name || 'U')[0].toUpperCase();

    const isDev = developerSessionUser.role === 'developer';
    document.querySelectorAll('[data-developer-only-nav], [data-developer-only-panel]').forEach((el) => {
      el.classList.toggle('hidden', !isDev);
    });

    // Bind UI outside the redirect-on-error path so a leftover handler cannot
    // bounce developer sessions between / and /user-management forever.
    bindUi();
  } catch (error) {
    console.error('User Management auth/init failed:', error);
    // Only redirect on auth/session failure. Developers always land back on
    // /user-management from /, which would otherwise create a reload loop.
    if (!sessionUser || !['developer', 'ceo', 'admin'].includes(sessionUser.role)) {
      window.location.href = sessionUser?.redirectTo || '/';
    }
    return;
  }

  try {
    showTab('overview');
    await loadStats();
    await loadUsers();
    await ensureCreateForm();
  } catch (error) {
    console.error('User Management workspace load failed:', error);
  }
}

window.initDeveloperControls = initDeveloperControls;

document.addEventListener('DOMContentLoaded', () => {
  if (document.body?.dataset?.umDashboard === 'true') {
    void initDeveloperControls();
    return;
  }
  if (document.body?.dataset?.devStandalone === 'true') {
    window.location.replace('/user-management');
  }
});
