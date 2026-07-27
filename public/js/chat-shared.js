/**
 * Shared Messenger-style chat rendering helpers (admin, cashier, member).
 * Loaded before page-specific scripts.
 */
(function (global) {
  function escapeChatHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatChatTimestamp(value) {
    if (!value) return '';
    return new Date(value).toLocaleString();
  }

  function isImageAttachment(file = {}) {
    const mime = String(file.mimeType || '');
    if (mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.originalName || file.filePath || '');
  }

  function renderAttachments(attachments = []) {
    if (!attachments.length) return '';
    return `<div class="chat-attachments">${attachments.map((file) => {
      const href = escapeChatHtml(file.filePath || '#');
      const name = escapeChatHtml(file.originalName || 'Attachment');
      if (isImageAttachment(file)) {
        return `
          <a class="chat-attachment chat-attachment-image" href="${href}" target="_blank" rel="noopener">
            <img src="${href}" alt="${name}" loading="lazy" />
            <span>${name}</span>
          </a>
        `;
      }
      return `
        <a class="chat-attachment chat-attachment-file" href="${href}" target="_blank" rel="noopener">
          📎 ${name}
        </a>
      `;
    }).join('')}</div>`;
  }

  function renderReplyQuote(replyTo) {
    if (!replyTo) return '';
    const preview = replyTo.body
      || (replyTo.hasAttachments ? 'Attachment' : 'Message');
    return `
      <blockquote class="chat-reply-quote">
        <strong>${escapeChatHtml(replyTo.senderName || 'Message')}</strong>
        <span>${escapeChatHtml(preview)}</span>
      </blockquote>
    `;
  }

  function renderChatMessages(threadEl, messages = [], viewerRole = 'admin', options = {}) {
    if (!threadEl) return;

    if (!messages.length) {
      threadEl.innerHTML = `<p class="table-subtitle chat-empty-state">${escapeChatHtml(options.emptyText || 'No messages yet. Start the conversation below.')}</p>`;
      return;
    }

    const previousScrollBottom = threadEl.scrollHeight - threadEl.scrollTop;
    const wasNearBottom = previousScrollBottom < threadEl.clientHeight + 80;

    threadEl.innerHTML = messages.map((message) => {
      const id = message.id || message._id;
      const isOwn = message.senderRole === viewerRole;
      const body = message.body && message.body !== 'Shared an attachment'
        ? `<p class="chat-bubble-body">${escapeChatHtml(message.body)}</p>`
        : (message.attachments?.length ? '' : `<p class="chat-bubble-body">${escapeChatHtml(message.body || '')}</p>`);
      return `
        <article class="chat-bubble ${isOwn ? 'chat-bubble-own' : 'chat-bubble-other'}" data-message-id="${escapeChatHtml(String(id))}">
          <div class="chat-bubble-meta">
            <strong>${escapeChatHtml(message.senderName || (message.senderRole === 'admin' ? 'Office' : 'Member'))}</strong>
            <span>${formatChatTimestamp(message.createdAt)}</span>
          </div>
          ${renderReplyQuote(message.replyTo)}
          ${body}
          ${renderAttachments(message.attachments || [])}
          <div class="chat-bubble-actions">
            <button type="button" class="chat-reply-btn" data-reply-to="${escapeChatHtml(String(id))}"
              data-reply-preview="${escapeChatHtml((message.body || 'Attachment').slice(0, 80))}"
              data-reply-name="${escapeChatHtml(message.senderName || '')}">
              Reply
            </button>
          </div>
        </article>
      `;
    }).join('');

    if (wasNearBottom || options.forceScroll) {
      threadEl.scrollTop = threadEl.scrollHeight;
    }

    if (typeof options.onReplyClick === 'function') {
      threadEl.querySelectorAll('[data-reply-to]').forEach((btn) => {
        btn.addEventListener('click', () => {
          options.onReplyClick({
            id: btn.dataset.replyTo,
            preview: btn.dataset.replyPreview || '',
            name: btn.dataset.replyName || '',
          });
        });
      });
    }
  }

  function readFilesAsPayload(fileList, { maxFiles = 4, maxBytes = 2.5 * 1024 * 1024 } = {}) {
    const files = Array.from(fileList || []).slice(0, maxFiles);
    return Promise.all(files.map((file) => new Promise((resolve, reject) => {
      if (file.size > maxBytes) {
        reject(new Error(`"${file.name}" exceeds ${(maxBytes / (1024 * 1024)).toFixed(1)} MB.`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({
          name: file.name,
          mimeType: file.type || '',
          size: file.size,
          data: base64,
        });
      };
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
      reader.readAsDataURL(file);
    })));
  }

  function lastMessagePreview(lastMessage) {
    if (!lastMessage) return 'Start a conversation';
    if (typeof lastMessage === 'string') return lastMessage;
    if (lastMessage.body && lastMessage.body !== 'Shared an attachment') return lastMessage.body;
    if (lastMessage.attachments?.length) return `📎 ${lastMessage.attachments[0].originalName || 'Attachment'}`;
    return lastMessage.body || 'Conversation';
  }

  global.SocietyChat = {
    escapeChatHtml,
    formatChatTimestamp,
    renderChatMessages,
    readFilesAsPayload,
    lastMessagePreview,
    POLL_MS: 2500,
  };
})(window);
