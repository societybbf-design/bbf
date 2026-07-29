/**
 * PDF language picker modal — choose Bengali or English before export.
 */
(function initPdfLanguagePicker() {
  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'pdfLanguageModal';
    modalEl.className = 'modal hidden';
    modalEl.innerHTML = `
      <div class="modal-content pdf-language-modal" role="dialog" aria-modal="true" aria-labelledby="pdfLanguageTitle">
        <div class="modal-header">
          <h2 id="pdfLanguageTitle" data-i18n="pdf.chooseLanguageTitle">Choose PDF language</h2>
          <button type="button" class="modal-close" id="pdfLanguageClose" aria-label="Close">&times;</button>
        </div>
        <p class="table-subtitle" data-i18n="pdf.chooseLanguageBody">Select the language for this official document.</p>
        <div class="pdf-language-options">
          <button type="button" class="primary-btn pdf-language-choice" data-pdf-lang="bn" data-i18n="pdf.bengali">বাংলা</button>
          <button type="button" class="secondary-btn pdf-language-choice" data-pdf-lang="en" data-i18n="pdf.english">English</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('#pdfLanguageClose')?.addEventListener('click', () => {
      modalEl.classList.add('hidden');
      modalEl._resolve?.(null);
    });
    modalEl.addEventListener('click', (event) => {
      if (event.target === modalEl) {
        modalEl.classList.add('hidden');
        modalEl._resolve?.(null);
      }
    });
    modalEl.querySelectorAll('.pdf-language-choice').forEach((button) => {
      button.addEventListener('click', () => {
        const lang = button.dataset.pdfLang === 'en' ? 'en' : 'bn';
        modalEl.classList.add('hidden');
        modalEl._resolve?.(lang);
      });
    });
    return modalEl;
  }

  function withLangParam(url, lang) {
    const target = new URL(url, window.location.origin);
    target.searchParams.set('lang', lang);
    return `${target.pathname}${target.search}`;
  }

  function promptPdfLanguage({ defaultLang } = {}) {
    return new Promise((resolve) => {
      const modal = ensureModal();
      window.I18n?.applyI18n?.(modal);
      modal._resolve = resolve;
      modal.classList.remove('hidden');

      if (defaultLang === 'bn' || defaultLang === 'en') {
        // Optional fast path: if caller passes explicit default and user already chose UI language, still show modal per spec.
      }
    });
  }

  async function openPdfWithLanguagePrompt(url, options = {}) {
    const lang = await promptPdfLanguage({ defaultLang: window.I18n?.getLanguage?.() });
    if (!lang) return null;
    const finalUrl = withLangParam(url, lang);
    if (options.newTab !== false) {
      window.open(finalUrl, '_blank', 'noopener');
    }
    return finalUrl;
  }

  function showPdfErrorToast(message) {
    let toast = document.getElementById('pdfDownloadErrorToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pdfDownloadErrorToast';
      toast.setAttribute('role', 'alert');
      toast.style.cssText = [
        'position:fixed',
        'z-index:10050',
        'left:50%',
        'bottom:1.25rem',
        'transform:translateX(-50%)',
        'max-width:min(92vw,420px)',
        'padding:0.85rem 1.1rem',
        'border-radius:12px',
        'background:#7f1d1d',
        'color:#fff',
        'box-shadow:0 12px 28px rgba(0,0,0,.28)',
        'font:600 0.92rem/1.35 system-ui,sans-serif',
        'display:none',
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = message || 'Unable to download PDF.';
    toast.style.display = 'block';
    window.clearTimeout(toast._hideTimer);
    toast._hideTimer = window.setTimeout(() => {
      toast.style.display = 'none';
    }, 5200);
  }

  async function fetchPdfBlob(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf,application/json' },
      skipPasswordConfirm: true,
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || contentType.includes('application/json')) {
      let message = `Download failed (${response.status || 'error'}).`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch (_) {
        // keep default message
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  function saveBlobAsFile(blob, filename = 'document.pdf') {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    return objectUrl;
  }

  async function triggerPdfDownload(button, url, options = {}) {
    if (!url) return null;

    let lang = options.lang || null;
    if (!options.skipLanguagePrompt) {
      lang = await promptPdfLanguage({ defaultLang: window.I18n?.getLanguage?.() });
      if (!lang) return null;
    }

    const finalUrl = lang ? withLangParam(url, lang) : url;
    const original = button?.textContent;
    if (button && !button.disabled) {
      const loadingKey = button.dataset.loadingLabelKey || 'pdf.generating';
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = window.I18n?.t?.(loadingKey, button.dataset.loadingLabel || 'Generating PDF…')
        || button.dataset.loadingLabel
        || 'Generating PDF…';
    }

    try {
      const blob = await fetchPdfBlob(finalUrl);
      const filename = options.filename
        || String(url).split('/').pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-')
        || 'document.pdf';
      const safeName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
      saveBlobAsFile(blob, safeName);
      if (options.openPreview) {
        window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      }
      return finalUrl;
    } catch (error) {
      console.error('[pdf-download]', error);
      showPdfErrorToast(error.message || 'Unable to download PDF.');
      if (typeof options.onError === 'function') {
        try { options.onError(error); } catch (_) { /* ignore */ }
      }
      throw error;
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        if (original != null) button.textContent = original;
        window.I18n?.applyI18n?.(button.parentElement || document);
      }
    }
  }

  window.PdfLanguage = {
    prompt: promptPdfLanguage,
    withLangParam,
    open: openPdfWithLanguagePrompt,
    triggerDownload: triggerPdfDownload,
    fetchPdfBlob,
    saveBlobAsFile,
    showError: showPdfErrorToast,
  };
})();
