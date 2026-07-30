/**
 * Shared notification list rendering + click-to-navigate helpers.
 */
(function (global) {
  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderNotificationItems(notifications = [], { idAttr = 'data-notification-id' } = {}) {
    if (!notifications.length) {
      return '<p class="table-subtitle notification-empty-state">No notifications yet.</p>';
    }
    return notifications.map((item) => {
      const id = item._id || item.id || '';
      const href = item.href || '';
      const link = item.link || '';
      return `
        <button type="button"
          class="notification-item ${item.read ? '' : 'notification-item-unread'}${href ? ' notification-item-link' : ''}"
          ${idAttr}="${escapeHtml(String(id))}"
          data-notification-href="${escapeHtml(href)}"
          data-notification-link="${escapeHtml(link)}"
          title="${href ? 'Open related page' : 'Mark as read'}">
          <strong>${escapeHtml(item.title || 'Notification')}</strong>
          <span>${escapeHtml(item.message || '')}</span>
          <small>${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}${href ? ' · Open →' : ''}</small>
        </button>
      `;
    }).join('');
  }

  async function markRead(url) {
    if (!url) return;
    try {
      await fetch(url, { method: 'PATCH', credentials: 'same-origin' });
    } catch (_error) {
      // Navigation should still proceed even if mark-read fails.
    }
  }

  function navigateToHref(href, { onSameDashboard } = {}) {
    if (!href) return false;
    try {
      const url = new URL(href, window.location.origin);
      const section = (url.hash || '').replace(/^#/, '');
      if (url.pathname === window.location.pathname && section && typeof onSameDashboard === 'function') {
        onSameDashboard(section);
        return true;
      }
      window.location.assign(url.pathname + url.search + url.hash);
      return true;
    } catch (_error) {
      window.location.href = href;
      return true;
    }
  }

  async function handleNotificationClick(itemEl, {
    readUrl,
    onSameDashboard,
    closePanel,
  } = {}) {
    if (!itemEl) return;
    const id = itemEl.getAttribute('data-notification-id')
      || itemEl.getAttribute('data-member-notification-id')
      || itemEl.getAttribute('data-staff-notification-id');
    const href = itemEl.getAttribute('data-notification-href') || '';
    if (typeof closePanel === 'function') closePanel();
    if (id && typeof readUrl === 'function') {
      await markRead(readUrl(id));
    } else if (id && typeof readUrl === 'string') {
      await markRead(readUrl.replace(':id', encodeURIComponent(id)));
    }
    if (href) {
      navigateToHref(href, { onSameDashboard });
    }
  }

  global.SocietyNotifications = {
    escapeHtml,
    renderNotificationItems,
    markRead,
    navigateToHref,
    handleNotificationClick,
  };
})(window);
