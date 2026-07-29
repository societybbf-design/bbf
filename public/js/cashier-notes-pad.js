'use strict';

/**
 * Floating Cashier Notes & Task Checklist.
 * - Fixed side FAB (draggable)
 * - Click opens interactive modal for free-form notes + daily checklist
 * - Persists to localStorage immediately and syncs to the server
 */
(function initCashierNotesPad(global) {
  const STORAGE_KEY = 'bbbf.cashierNotesPad.v1';
  const SAVE_DEBOUNCE_MS = 450;

  let state = {
    notes: '',
    tasks: [],
    checklistDay: '',
    fabPosition: { side: 'right', leftPct: null, topPct: null },
    updatedAt: null,
  };
  let saveTimer = null;
  let dragSession = null;
  let bound = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function newTaskId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function writeLocal(pad) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        notes: pad.notes || '',
        tasks: pad.tasks || [],
        checklistDay: pad.checklistDay || todayKey(),
        fabPosition: pad.fabPosition || { side: 'right' },
        updatedAt: pad.updatedAt || new Date().toISOString(),
      }));
    } catch (_) {
      // ignore quota / private mode
    }
  }

  function applyDayRollover(pad) {
    const day = todayKey();
    if ((pad.checklistDay || '') === day) return pad;
    return {
      ...pad,
      checklistDay: day,
      tasks: (pad.tasks || []).filter((task) => !task.done),
    };
  }

  function mergePads(serverPad, localPad) {
    if (!localPad) return applyDayRollover(serverPad || defaultPad());
    if (!serverPad) return applyDayRollover(localPad);
    const serverTime = Date.parse(serverPad.updatedAt || 0) || 0;
    const localTime = Date.parse(localPad.updatedAt || 0) || 0;
    const preferred = localTime > serverTime ? localPad : serverPad;
    return applyDayRollover({
      ...preferred,
      fabPosition: preferred.fabPosition || serverPad.fabPosition || localPad.fabPosition,
    });
  }

  function defaultPad() {
    return {
      notes: '',
      tasks: [],
      checklistDay: todayKey(),
      fabPosition: { side: 'right', leftPct: null, topPct: null },
      updatedAt: null,
    };
  }

  function openTaskCount() {
    return (state.tasks || []).filter((task) => !task.done).length;
  }

  function ensureDom() {
    let fab = document.getElementById('cashierNotesFab');
    let modal = document.getElementById('cashierNotesModal');

    if (!fab) {
      fab = document.createElement('button');
      fab.type = 'button';
      fab.id = 'cashierNotesFab';
      fab.className = 'cashier-notes-fab';
      fab.setAttribute('aria-label', 'Open notes and task checklist');
      fab.setAttribute('aria-haspopup', 'dialog');
      fab.innerHTML = `
        <span class="cashier-notes-fab-icon" aria-hidden="true">📝</span>
        <span class="cashier-notes-fab-label">Notes</span>
        <span class="cashier-notes-fab-badge" id="cashierNotesFabBadge" hidden>0</span>
      `;
      document.body.appendChild(fab);
    }

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cashierNotesModal';
      modal.className = 'modal cashier-notes-modal hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'cashierNotesModalTitle');
      modal.innerHTML = `
        <div class="modal-content cashier-notes-modal-content">
          <div class="modal-header">
            <div>
              <h2 id="cashierNotesModalTitle">Notes &amp; Task Checklist</h2>
              <p class="table-subtitle" id="cashierNotesModalSubtitle">Personal workspace — saved automatically</p>
            </div>
            <div class="modal-header-actions">
              <button type="button" class="modal-close" id="cashierNotesModalClose" aria-label="Close">&times;</button>
            </div>
          </div>

          <div class="cashier-notes-modal-body">
            <section class="cashier-notes-section">
              <div class="cashier-notes-section-head">
                <h3>Free-form notes</h3>
                <span class="cashier-notes-save-status" id="cashierNotesSaveStatus">Saved</span>
              </div>
              <textarea
                id="cashierNotesTextarea"
                class="cashier-notes-textarea"
                rows="7"
                placeholder="Write reminders, member follow-ups, payment notes…"
                spellcheck="true"
              ></textarea>
            </section>

            <section class="cashier-notes-section">
              <div class="cashier-notes-section-head">
                <h3>Today’s checklist</h3>
                <span class="table-subtitle" id="cashierNotesDayLabel"></span>
              </div>
              <form id="cashierNotesAddTaskForm" class="cashier-notes-add-row">
                <input
                  type="text"
                  id="cashierNotesTaskInput"
                  maxlength="500"
                  placeholder="Add a task…"
                  autocomplete="off"
                />
                <button type="submit" class="primary-btn">Add</button>
              </form>
              <ul class="cashier-notes-task-list" id="cashierNotesTaskList"></ul>
              <div class="cashier-notes-task-actions">
                <button type="button" class="secondary-btn" id="cashierNotesClearDone">Clear completed</button>
              </div>
            </section>
          </div>

          <p class="table-subtitle cashier-notes-hint">
            Tip: drag the Notes button to park it on either side of the screen.
          </p>
        </div>
      `;
      document.body.appendChild(modal);
    }

    return { fab, modal };
  }

  function setSaveStatus(text, isError = false) {
    const el = document.getElementById('cashierNotesSaveStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(isError));
    el.classList.toggle('is-saving', text === 'Saving…');
  }

  function applyFabPosition() {
    const fab = document.getElementById('cashierNotesFab');
    if (!fab) return;
    const pos = state.fabPosition || {};
    fab.classList.toggle('is-left', pos.side === 'left');
    fab.classList.toggle('is-right', pos.side !== 'left');

    if (pos.leftPct != null && pos.topPct != null) {
      fab.style.left = `${pos.leftPct}%`;
      fab.style.top = `${pos.topPct}%`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      fab.style.transform = 'translate(-50%, -50%)';
    } else {
      fab.style.left = '';
      fab.style.top = '';
      fab.style.right = '';
      fab.style.bottom = '';
      fab.style.transform = '';
    }
  }

  function updateFabBadge() {
    const badge = document.getElementById('cashierNotesFabBadge');
    if (!badge) return;
    const count = openTaskCount();
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = String(count);
    } else {
      badge.hidden = true;
      badge.textContent = '0';
    }
  }

  function renderTasks() {
    const list = document.getElementById('cashierNotesTaskList');
    const dayLabel = document.getElementById('cashierNotesDayLabel');
    if (dayLabel) {
      const day = state.checklistDay || todayKey();
      dayLabel.textContent = day === todayKey()
        ? new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : day;
    }
    if (!list) return;

    const tasks = state.tasks || [];
    if (!tasks.length) {
      list.innerHTML = '<li class="cashier-notes-empty">No tasks yet. Add one above.</li>';
      updateFabBadge();
      return;
    }

    list.innerHTML = tasks.map((task) => `
      <li class="cashier-notes-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}">
        <label class="cashier-notes-task-label">
          <input type="checkbox" class="cashier-notes-task-check" ${task.done ? 'checked' : ''} />
          <span class="cashier-notes-task-text">${escapeHtml(task.text)}</span>
        </label>
        <button type="button" class="cashier-notes-task-delete" aria-label="Delete task">&times;</button>
      </li>
    `).join('');
    updateFabBadge();
  }

  function renderAll() {
    const textarea = document.getElementById('cashierNotesTextarea');
    if (textarea && textarea.value !== (state.notes || '')) {
      textarea.value = state.notes || '';
    }
    renderTasks();
    applyFabPosition();
    updateFabBadge();
  }

  function scheduleSave(reason = 'edit') {
    setSaveStatus('Saving…');
    writeLocal({ ...state, updatedAt: new Date().toISOString() });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persistToServer(reason);
    }, SAVE_DEBOUNCE_MS);
  }

  async function persistToServer() {
    try {
      const res = await fetch('/api/cashier-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: state.notes,
          tasks: state.tasks,
          fabPosition: state.fabPosition,
        }),
        skipPasswordConfirm: true,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to save notes.');
      state = {
        ...state,
        ...data,
        fabPosition: data.fabPosition || state.fabPosition,
      };
      writeLocal(state);
      setSaveStatus('Saved');
      updateFabBadge();
    } catch (error) {
      // Keep local copy; surface soft error
      setSaveStatus('Saved on this device', true);
      console.warn('[cashier-notes]', error.message);
    }
  }

  function openModal() {
    const { modal } = ensureDom();
    renderAll();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('cashierNotesTextarea')?.focus();
    }, 30);
  }

  function closeModal() {
    const modal = document.getElementById('cashierNotesModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = '';
    // Flush pending save on close
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void persistToServer('close');
    }
  }

  function isModalOpen() {
    const modal = document.getElementById('cashierNotesModal');
    return Boolean(modal && !modal.classList.contains('hidden'));
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    const { fab, modal } = ensureDom();

    fab.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      dragSession = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        originLeft: fab.getBoundingClientRect().left + fab.offsetWidth / 2,
        originTop: fab.getBoundingClientRect().top + fab.offsetHeight / 2,
      };
      fab.setPointerCapture?.(event.pointerId);
      fab.classList.add('is-dragging');
    });

    fab.addEventListener('pointermove', (event) => {
      if (!dragSession || dragSession.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragSession.startX;
      const dy = event.clientY - dragSession.startY;
      if (!dragSession.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        dragSession.moved = true;
      }
      if (!dragSession.moved) return;

      const x = Math.min(window.innerWidth - 8, Math.max(8, dragSession.originLeft + dx));
      const y = Math.min(window.innerHeight - 8, Math.max(8, dragSession.originTop + dy));
      const leftPct = (x / window.innerWidth) * 100;
      const topPct = (y / window.innerHeight) * 100;
      const side = leftPct < 50 ? 'left' : 'right';
      state.fabPosition = { leftPct, topPct, side };
      applyFabPosition();
    });

    const endDrag = (event) => {
      if (!dragSession || dragSession.pointerId !== event.pointerId) return;
      const wasDrag = dragSession.moved;
      fab.classList.remove('is-dragging');
      fab.releasePointerCapture?.(event.pointerId);
      dragSession = null;
      if (wasDrag) {
        scheduleSave('drag');
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openModal();
    };

    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', () => {
      fab.classList.remove('is-dragging');
      dragSession = null;
    });

    // Keyboard activation without requiring pointer drag semantics
    fab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModal();
      }
    });

    document.getElementById('cashierNotesModalClose')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isModalOpen()) closeModal();
    });

    document.getElementById('cashierNotesTextarea')?.addEventListener('input', (event) => {
      state.notes = event.target.value;
      scheduleSave('notes');
    });

    document.getElementById('cashierNotesAddTaskForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.getElementById('cashierNotesTaskInput');
      const text = String(input?.value || '').trim();
      if (!text) return;
      state.tasks = [
        ...(state.tasks || []),
        {
          id: newTaskId(),
          text,
          done: false,
          createdAt: new Date().toISOString(),
          completedAt: null,
        },
      ];
      if (input) input.value = '';
      renderTasks();
      scheduleSave('add-task');
    });

    document.getElementById('cashierNotesTaskList')?.addEventListener('change', (event) => {
      const check = event.target.closest('.cashier-notes-task-check');
      if (!check) return;
      const row = check.closest('[data-task-id]');
      const id = row?.dataset?.taskId;
      if (!id) return;
      state.tasks = (state.tasks || []).map((task) => {
        if (task.id !== id) return task;
        const done = Boolean(check.checked);
        return {
          ...task,
          done,
          completedAt: done ? new Date().toISOString() : null,
        };
      });
      renderTasks();
      scheduleSave('toggle-task');
    });

    document.getElementById('cashierNotesTaskList')?.addEventListener('click', (event) => {
      const del = event.target.closest('.cashier-notes-task-delete');
      if (!del) return;
      const row = del.closest('[data-task-id]');
      const id = row?.dataset?.taskId;
      if (!id) return;
      state.tasks = (state.tasks || []).filter((task) => task.id !== id);
      renderTasks();
      scheduleSave('delete-task');
    });

    document.getElementById('cashierNotesClearDone')?.addEventListener('click', () => {
      const before = (state.tasks || []).length;
      state.tasks = (state.tasks || []).filter((task) => !task.done);
      if (state.tasks.length === before) return;
      renderTasks();
      scheduleSave('clear-done');
    });
  }

  async function loadPad() {
    const local = readLocal();
    if (local) {
      state = applyDayRollover({ ...defaultPad(), ...local });
      renderAll();
    }

    try {
      const res = await fetch('/api/cashier-notes', { skipPasswordConfirm: true });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to load notes.');
      state = mergePads(data, local);
      writeLocal(state);
      renderAll();
      // If local was ahead, push it once
      if (local && (Date.parse(local.updatedAt || 0) || 0) > (Date.parse(data.updatedAt || 0) || 0)) {
        scheduleSave('sync-up');
      }
    } catch (error) {
      if (!local) {
        state = defaultPad();
        renderAll();
      }
      console.warn('[cashier-notes] load failed, using local cache:', error.message);
    }
  }

  async function boot() {
    ensureDom();
    bindEvents();
    applyFabPosition();
    await loadPad();
  }

  global.CashierNotesPad = {
    boot,
    open: openModal,
    close: closeModal,
    reload: loadPad,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void boot(); });
  } else {
    void boot();
  }
})(window);
