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

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

const TAB_TITLES = {
  overview: ['Overview', 'Account totals, locks, and OTP status at a glance.'],
  create: ['Create Account', 'Create members, investors, project managers, staff, and CEOs.'],
  users: ['All Accounts', 'Browse by role, search, manage lock/active states, passwords, and soft-delete/restore.'],
  recovery: ['OTP Recovery', 'Verify user OTPs and set a new password safely.'],
  audits: ['Security Audit', 'Login failures, lockouts, OTP requests, and account changes.'],
  security: ['My Security', 'Update your own User Management password.'],
};

const ROLE_DIRECTORY = [
  { id: 'member', label: 'Members', roles: ['member'] },
  { id: 'investor', label: 'Investors', roles: ['investor'] },
  { id: 'ceo', label: 'CEOs', roles: ['ceo', 'admin'] },
  { id: 'project_manager', label: 'Managers', roles: ['project_manager'] },
  { id: 'cashier', label: 'Cashiers', roles: ['cashier'] },
  { id: 'employee', label: 'Employees', roles: ['employee'] },
  { id: 'developer', label: 'UM Admins', roles: ['developer'] },
];

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

  const titles = TAB_TITLES[tab] || TAB_TITLES.overview;
  const pageTitle = document.getElementById('pageTitle');
  const pageNote = document.getElementById('pageNote');
  if (pageTitle) pageTitle.textContent = titles[0];
  if (pageNote) pageNote.textContent = titles[1];

  if (tab === 'users') loadUsers();
  if (tab === 'create') void ensureCreateForm();
  if (tab === 'recovery') loadRecoveryOptions();
  if (tab === 'audits') loadAudits();
  if (tab === 'overview') loadStats();
}

function renderUmPermissions(selectedKeys = []) {
  const grid = document.getElementById('devPermissionsGrid');
  if (!grid) return;
  const selected = new Set(selectedKeys);
  grid.innerHTML = (umMeta.permissions || []).map((perm) => `
    <label class="permission-chip">
      <input type="checkbox" value="${escapeHtml(perm.key)}" ${selected.has(perm.key) ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(perm.label)}</strong>
        <small>${escapeHtml(perm.description || '')}</small>
      </span>
    </label>
  `).join('');
}

function applyUmRoleDefaults() {
  const role = document.getElementById('devRoleSelect')?.value;
  const match = (umMeta.roles || []).find((r) => r.value === role);
  renderUmPermissions(match?.defaultPermissions || []);
  void updateMemberBuyInUi(role);
}

async function updateMemberBuyInUi(role) {
  const block = document.getElementById('devMemberBuyInBlock');
  const box = document.getElementById('devEntryValuationBox');
  const input = document.getElementById('devEntryAmountPaid');
  if (!block || !box) return;

  if (role !== 'member') {
    block.classList.add('hidden');
    if (input) input.value = '';
    return;
  }

  block.classList.remove('hidden');
  box.innerHTML = '<p class="table-subtitle">Loading current share valuation…</p>';
  try {
    const data = await api('/api/developer/entry-valuation');
    const v = data.valuation || {};
    const amount = Number(v.entryAmount || 0);
    box.innerHTML = `
      <p><strong>Current share valuation: $${amount.toFixed(2)}</strong></p>
      <p class="table-subtitle">${escapeHtml(v.formula || '')}</p>
      <p class="table-subtitle">Active members: ${v.activeCount || 0} · Fund: Savings $${Number(v.totalSavings || 0).toFixed(2)} + Profit $${Number(v.totalProfit || 0).toFixed(2)} + Advance $${Number(v.totalAdvance || 0).toFixed(2)} = $${Number(v.totalFund || 0).toFixed(2)}</p>
    `;
    if (input) {
      input.placeholder = amount > 0
        ? `Exact $${amount.toFixed(2)} to activate now, or leave blank`
        : 'No buy-in required — activates immediately';
      input.dataset.requiredAmount = String(amount);
    }
  } catch (error) {
    box.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  }
}

function getUmSelectedPermissions() {
  return Array.from(document.querySelectorAll('#devPermissionsGrid input[type="checkbox"]:checked'))
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
      renderUmPermissions((umMeta.permissions || []).map((p) => p.key));
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
      const entryRaw = formData.get('entryAmountPaid');
      const payload = {
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        role,
        permissions: getUmSelectedPermissions(),
      };
      if (role === 'member' && entryRaw !== null && String(entryRaw).trim() !== '') {
        payload.entryAmountPaid = entryRaw;
      }
      try {
        const result = await api('/api/developer/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (messageEl) {
          const required = result.valuation?.entryAmount;
          const suffix = result.activated === false && required != null
            ? ` Pending exact buy-in of $${Number(required).toFixed(2)}.`
            : '';
          messageEl.textContent = (result.message || 'Account created.') + suffix;
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
    ['Soft-deleted', stats.deleted || 0],
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
  if (label) label.textContent = `Showing ${entry.label}`;

  renderActiveRoleDirectory();
}

function renderActiveRoleDirectory() {
  renderUsersTable(usersForRoleTab(activeRoleTab));
}

function lockBadge(user) {
  if (user.status === 'deleted') {
    return `<span class="status-pill">Deleted ${formatDate(user.deletedAt)}</span>`;
  }
  if (user.pendingEntryBuyIn) {
    return `<span class="status-pill">Buy-in $${Number(user.requiredEntryAmount || 0).toFixed(2)}</span>`;
  }
  if (user.isTemporarilyLocked) return '<span class="status-pill">Locked 24h</span>';
  if (user.hasPendingOtp) return '<span class="status-pill">OTP pending</span>';
  if (user.failedLoginAttempts) return `${user.failedLoginAttempts} fails`;
  return '—';
}

function renderUsersTable(users) {
  const tbody = document.getElementById('devUsersTable');
  if (!tbody) return;
  const entry = getRoleDirectoryEntry();
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6">No ${escapeHtml(entry.label.toLowerCase())} found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.roleLabel || user.role)}</td>
      <td>${escapeHtml(user.status)}</td>
      <td>${lockBadge(user)}</td>
      <td>
        <button type="button" class="ghost-btn" data-manage-user="${user.id || user._id}">Manage</button>
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
  if (eyebrowEl) eyebrowEl.textContent = 'Updating profile for';
  if (titleEl) titleEl.textContent = displayName;
  if (emailEl) emailEl.textContent = displayEmail;
  if (metaEl) metaEl.textContent = `${roleLabel} · Status: ${user.status || '—'}`;

  const isDeleted = user.status === 'deleted';
  document.getElementById('devUserModalBody').innerHTML = `
    <div class="um-modal-subject" aria-live="polite">
      <p class="um-modal-subject-line">You are managing <strong>${escapeHtml(displayName)}</strong></p>
      <p class="um-modal-subject-email">${escapeHtml(displayEmail)}</p>
    </div>
    <p class="small-label">Failed logins: ${user.failedLoginAttempts || 0} · Lock until: ${formatDate(user.lockUntil)} · Last login: ${formatDate(user.lastLoginAt)}</p>
    ${isDeleted ? `
      <p class="table-subtitle">Soft-deleted ${formatDate(user.deletedAt)} by ${escapeHtml(user.deletedBy || '—')}. Reason: ${escapeHtml(user.deletedReason || '—')}. Financial records were preserved and can be restored anytime.</p>
      <div class="ceo-dev-status-actions">
        <button type="button" class="primary-btn" data-action="restore">Restore account</button>
      </div>
    ` : `
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
        <button type="button" class="ghost-btn" data-action="unlock">Clear lockout</button>
        <button type="button" class="ghost-btn" data-action="soft-delete">Soft-delete</button>
      </div>
    `}
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
      msg.textContent = 'Password updated and lockout cleared.';
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
        msg.textContent = `Status set to ${btn.dataset.status}.`;
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
      msg.textContent = 'Temporary lockout cleared.';
      await loadUsers();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.querySelector('#devUserModalBody [data-action="soft-delete"]')?.addEventListener('click', async () => {
    const msg = document.getElementById('devModalMessage');
    const reason = window.prompt('Optional reason for soft-delete (financial records are preserved):', '') || '';
    if (!window.confirm(`Soft-delete ${displayName} (${displayEmail})? It can be restored later from User Management.`)) return;
    try {
      await api(`/api/developer/users/${selectedUserId}/soft-delete`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      msg.textContent = 'Account soft-deleted. Financial records preserved.';
      modal.classList.add('hidden');
      await loadUsers();
      await loadStats();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  document.querySelector('#devUserModalBody [data-action="restore"]')?.addEventListener('click', async () => {
    const msg = document.getElementById('devModalMessage');
    if (!window.confirm(`Restore ${displayName} (${displayEmail}) to active? Linked financial history stays intact.`)) return;
    try {
      await api(`/api/developer/users/${selectedUserId}/restore`, {
        method: 'POST',
        body: '{}',
      });
      msg.textContent = 'Account restored.';
      modal.classList.add('hidden');
      await loadUsers();
      await loadStats();
    } catch (error) {
      msg.textContent = error.message;
    }
  });
}

function loadRecoveryOptions() {
  const select = document.getElementById('otpUserSelect');
  if (!select) return;
  const pending = cachedUsers.filter((u) => u.hasPendingOtp);
  const options = (pending.length ? pending : cachedUsers.filter((u) => u.status !== 'deleted')).map((u) => `
    <option value="${escapeHtml(u.id || u._id)}">
      ${escapeHtml(u.name)} (${escapeHtml(u.email)})${u.hasPendingOtp ? ' · OTP pending' : ''}
    </option>
  `).join('');
  select.innerHTML = `<option value="">Select user…</option>${options}`;
}

async function loadAudits() {
  const tbody = document.getElementById('devAuditsTable');
  if (!tbody) return;
  const { audits } = await api('/api/developer/audits?limit=100');
  if (!audits?.length) {
    tbody.innerHTML = '<tr><td colspan="5">No audit events yet.</td></tr>';
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
      msg.textContent = 'OTP verified. New password set and account unlocked.';
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
      msg.textContent = 'Password updated.';
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
  try {
    const session = await api('/api/session');
    developerSessionUser = session.user;
    if (!developerSessionUser || !['developer', 'ceo', 'admin'].includes(developerSessionUser.role)) {
      window.location.href = session.user?.redirectTo || '/';
      return;
    }

    const nameEl = document.getElementById('umSidebarName');
    const initialEl = document.getElementById('umSidebarInitial');
    if (nameEl) nameEl.textContent = developerSessionUser.name || 'User Management';
    if (initialEl) initialEl.textContent = (developerSessionUser.name || 'U')[0].toUpperCase();

    bindUi();
    showTab('overview');
    await loadStats();
    await loadUsers();
    await ensureCreateForm();
  } catch (error) {
    console.error('User Management init failed:', error);
    window.location.href = '/';
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
