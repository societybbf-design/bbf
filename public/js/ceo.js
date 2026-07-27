const createUserForm = document.getElementById('createUserForm');
const roleSelect = document.getElementById('roleSelect');
const permissionsGrid = document.getElementById('permissionsGrid');
const createMessage = document.getElementById('createMessage');
const staffMessage = document.getElementById('staffMessage');
const staffTableBody = document.querySelector('#staffTable tbody');
const ceoWelcome = document.getElementById('ceoWelcome');
const createSection = document.getElementById('createSection');
const staffSection = document.getElementById('staffSection');

let meta = { roles: [], permissions: [] };

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderPermissions(selectedKeys = []) {
  const selected = new Set(selectedKeys);
  permissionsGrid.innerHTML = meta.permissions.map((perm) => `
    <label class="permission-item">
      <input type="checkbox" name="permissions" value="${perm.key}" ${selected.has(perm.key) ? 'checked' : ''} />
      <span>
        <strong>${perm.label}</strong>
        <small>${perm.description}</small>
      </span>
    </label>
  `).join('');
}

function applyRoleDefaults() {
  const role = roleSelect.value;
  const match = meta.roles.find((item) => item.value === role);
  renderPermissions(match?.defaultPermissions || []);
}

function getSelectedPermissions() {
  return [...permissionsGrid.querySelectorAll('input[name="permissions"]:checked')].map((el) => el.value);
}

function showSection(name) {
  const isCreate = name === 'create';
  createSection.classList.toggle('hidden', !isCreate);
  staffSection.classList.toggle('hidden', isCreate);
  document.querySelectorAll('.sidebar-nav .nav-item[data-section]').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === name);
  });
}

async function loadStaff() {
  staffMessage.textContent = '';
  try {
    const { staff } = await api('/api/ceo/staff');
    if (!staff.length) {
      staffTableBody.innerHTML = '<tr><td colspan="5">No staff users yet.</td></tr>';
      return;
    }
    staffTableBody.innerHTML = staff.map((user) => `
      <tr>
        <td data-label="Name">${escapeHtml(user.name)}</td>
        <td data-label="Email">${escapeHtml(user.email)}</td>
        <td data-label="Role"><span class="badge">${escapeHtml(user.roleLabel || user.role)}</span></td>
        <td data-label="Permissions"><span class="perm-count">${(user.permissions || []).length} granted</span></td>
        <td data-label="Status">${escapeHtml(user.status || 'active')}</td>
      </tr>
    `).join('');
  } catch (error) {
    staffMessage.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function init() {
  try {
    const session = await api('/api/session');
    if (!session.user || !['ceo', 'admin'].includes(session.user.role)) {
      window.location.href = session.user?.redirectTo || '/';
      return;
    }
    ceoWelcome.textContent = `Signed in as ${session.user.name} · ${session.user.email}`;

    meta = await api('/api/ceo/meta');
    roleSelect.innerHTML = meta.roles.map((role) => (
      `<option value="${role.value}">${role.label}</option>`
    )).join('');
    applyRoleDefaults();
    await loadStaff();
  } catch (error) {
    createMessage.textContent = error.message || 'Unable to load CEO panel.';
  }
}

roleSelect.addEventListener('change', applyRoleDefaults);

document.getElementById('selectAllPerms').addEventListener('click', () => {
  renderPermissions(meta.permissions.map((p) => p.key));
});

document.getElementById('clearPerms').addEventListener('click', () => {
  renderPermissions([]);
});

document.querySelectorAll('.sidebar-nav .nav-item[data-section]').forEach((el) => {
  el.addEventListener('click', (event) => {
    event.preventDefault();
    showSection(el.dataset.section);
    if (el.dataset.section === 'staff') loadStaff();
  });
});

createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  createMessage.textContent = '';
  const formData = new FormData(createUserForm);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    permissions: getSelectedPermissions(),
  };

  try {
    await api('/api/ceo/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    createMessage.textContent = 'User created successfully.';
    createMessage.classList.add('success');
    createUserForm.reset();
    applyRoleDefaults();
    await loadStaff();
  } catch (error) {
    createMessage.classList.remove('success');
    createMessage.textContent = error.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

init();
