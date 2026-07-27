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

  async function triggerPdfDownload(button, url, options = {}) {
    if (!url) return null;
    const lang = await promptPdfLanguage({ defaultLang: window.I18n?.getLanguage?.() });
    if (!lang) return null;

    const finalUrl = withLangParam(url, lang);
    if (button && !button.disabled) {
      const loadingKey = button.dataset.loadingLabelKey || 'pdf.generating';
      const original = button.textContent;
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = window.I18n?.t?.(loadingKey, button.dataset.loadingLabel || 'Generating PDF…') || 'Generating PDF…';
      window.open(finalUrl, '_blank', 'noopener');
      window.setTimeout(() => {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = original;
        window.I18n?.applyI18n?.(button.parentElement || document);
      }, 900);
    } else {
      window.open(finalUrl, '_blank', 'noopener');
    }
    return finalUrl;
  }

  window.PdfLanguage = {
    prompt: promptPdfLanguage,
    withLangParam,
    open: openPdfWithLanguagePrompt,
    triggerDownload: triggerPdfDownload,
  };
})();
