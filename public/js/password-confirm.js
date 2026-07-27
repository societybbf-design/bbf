/**
 * Shared password re-confirmation modal for sensitive Cashier / Manager / CEO actions.
 */
(function (global) {
  const STYLE_ID = 'password-confirm-styles';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .pw-confirm-overlay {
        position: fixed; inset: 0; z-index: 10050;
        background: rgba(15, 23, 42, 0.55);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
      }
      .pw-confirm-overlay.hidden { display: none; }
      .pw-confirm-dialog {
        width: min(420px, 100%);
        background: var(--card-bg, #fff);
        color: var(--text-primary, #0f172a);
        border-radius: 12px;
        box-shadow: 0 20px 50px rgba(0,0,0,.25);
        padding: 1.25rem 1.35rem;
      }
      .pw-confirm-dialog h3 { margin: 0 0 .35rem; font-size: 1.15rem; }
      .pw-confirm-dialog p { margin: 0 0 1rem; color: var(--text-secondary, #64748b); font-size: .92rem; }
      .pw-confirm-dialog input {
        width: 100%; padding: .7rem .8rem; margin-bottom: .85rem;
        border: 1px solid var(--border-color, #cbd5e1); border-radius: 8px;
        background: var(--input-bg, #fff); color: inherit;
      }
      .pw-confirm-actions { display: flex; gap: .6rem; justify-content: flex-end; }
      .pw-confirm-error { color: #b91c1c; font-size: .85rem; min-height: 1.2em; margin: 0 0 .5rem; }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    ensureStyles();
    let overlay = document.getElementById('pwConfirmOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'pwConfirmOverlay';
    overlay.className = 'pw-confirm-overlay hidden';
    overlay.innerHTML = `
      <div class="pw-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pwConfirmTitle">
        <h3 id="pwConfirmTitle">Confirm your password</h3>
        <p id="pwConfirmHint">Re-enter your account password to authorize this sensitive action.</p>
        <p class="pw-confirm-error" id="pwConfirmError"></p>
        <form id="pwConfirmForm">
          <label>
            Account password
            <input type="password" id="pwConfirmInput" name="password" autocomplete="current-password" required />
          </label>
          <div class="pw-confirm-actions">
            <button type="button" class="ghost-btn" id="pwConfirmCancel">Cancel</button>
            <button type="submit" class="primary-btn">Confirm</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function promptPasswordConfirmation(message) {
    const overlay = ensureModal();
    const input = document.getElementById('pwConfirmInput');
    const errorEl = document.getElementById('pwConfirmError');
    const hint = document.getElementById('pwConfirmHint');
    const form = document.getElementById('pwConfirmForm');
    const cancelBtn = document.getElementById('pwConfirmCancel');

    hint.textContent = message || 'Re-enter your account password to authorize this sensitive action.';
    errorEl.textContent = '';
    input.value = '';
    overlay.classList.remove('hidden');
    setTimeout(() => input.focus(), 30);

    return new Promise((resolve) => {
      function cleanup(result) {
        form.onsubmit = null;
        cancelBtn.onclick = null;
        overlay.onclick = null;
        overlay.classList.add('hidden');
        resolve(result);
      }

      form.onsubmit = (event) => {
        event.preventDefault();
        const value = input.value;
        if (!value) {
          errorEl.textContent = 'Password is required.';
          return;
        }
        cleanup(value);
      };

      cancelBtn.onclick = () => cleanup(null);
      overlay.onclick = (event) => {
        if (event.target === overlay) cleanup(null);
      };
    });
  }

  function injectConfirmPassword(init, password) {
    const next = { ...(init || {}) };
    next.headers = { ...(init?.headers || {}) };

    if (password) {
      next.headers['X-Confirm-Password'] = password;
    }

    if (!next.body || typeof next.body !== 'string') {
      return next;
    }

    try {
      const parsed = JSON.parse(next.body);
      if (password) parsed.confirmPassword = password;
      else delete parsed.confirmPassword;
      next.body = JSON.stringify(parsed);
    } catch {
      // leave body as-is; header still carries confirmation
    }
    return next;
  }

  const rawFetch = global.fetch.bind(global);

  async function secureFetch(input, init = {}) {
    const { skipPasswordConfirm, ...fetchInit } = init || {};
    const method = String(fetchInit.method || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isApi = String(url).startsWith('/api/');
    const skip = skipPasswordConfirm
      || String(url).startsWith('/api/auth/')
      || String(url).startsWith('/api/developer/')
      || String(url).startsWith('/api/member/');

    if (!mutating || !isApi || skip) {
      return rawFetch(input, fetchInit);
    }

    let response = await rawFetch(input, injectConfirmPassword(fetchInit));
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return response;
    }

    const data = await response.clone().json().catch(() => ({}));
    if (
      (response.status === 401 || response.status === 403)
      && data.requiresPasswordConfirmation
    ) {
      const password = await promptPasswordConfirmation(data.error);
      if (!password) {
        return response;
      }
      return rawFetch(input, injectConfirmPassword(fetchInit, password));
    }

    return response;
  }

  // Install as default fetch so existing admin/staff UI picks up confirmation automatically
  global.fetch = secureFetch;
  global.promptPasswordConfirmation = promptPasswordConfirmation;
  global.secureFetch = secureFetch;
  global.__rawFetch = rawFetch;
})(window);
