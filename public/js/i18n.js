/**
 * Client-side internationalization for Bondhutto-er Bandhon Foundation.
 */
(function initI18n() {
  const STORAGE_KEY = 'bbbf-language';
  const DEFAULT_PORTAL_LABELS = {
    ceo: { bn: 'সিইও ড্যাশবোর্ড', en: 'CEO Dashboard' },
    member: { bn: 'সদস্য পোর্টাল', en: 'Member Portal' },
    cashier: { bn: 'ক্যাশিয়ার ড্যাশবোর্ড', en: 'Cashier Dashboard' },
    staff: { bn: 'স্টাফ ড্যাশবোর্ড', en: 'Staff Dashboard' },
    userManagement: { bn: 'ব্যবহারকারী ব্যবস্থাপনা', en: 'User Management' },
    ceoPanel: { bn: 'সিইও কন্ট্রোল প্যানেল', en: 'CEO Control Panel' },
    developer: { bn: 'ডেভেলপার পোর্টাল', en: 'Developer Portal' },
  };

  let dictionaries = { en: {}, bn: {} };
  let branding = null;
  let language = localStorage.getItem(STORAGE_KEY) || 'bn';
  let ready = false;
  const readyWaiters = [];

  function normalizeLanguage(value) {
    return String(value || '').toLowerCase() === 'en' ? 'en' : 'bn';
  }

  function getLanguage() {
    return normalizeLanguage(language);
  }

  function resolvePath(obj, path) {
    return String(path || '').split('.').reduce((acc, part) => (
      acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined
    ), obj);
  }

  function t(key, fallback = '') {
    const lang = getLanguage();
    const value = resolvePath(dictionaries[lang], key);
    if (value !== undefined && value !== null && value !== '') return String(value);
    const english = resolvePath(dictionaries.en, key);
    if (english !== undefined && english !== null && english !== '') return String(english);
    return fallback || key;
  }

  function pageTitle(suffix) {
    const name = getLanguage() === 'en' ? (branding?.nameEn || '') : (branding?.nameBn || '');
    return suffix ? `${suffix} - ${name}` : name;
  }

  function portalLabel(portalKey) {
    const labels = branding?.portalLabels?.[portalKey] || DEFAULT_PORTAL_LABELS[portalKey];
    if (!labels) return portalKey;
    return labels[getLanguage()] || labels.en || portalKey;
  }

  function eyebrowText(portalKey) {
    const name = getLanguage() === 'en' ? (branding?.nameEn || '') : (branding?.nameBn || '');
    return `${name} ${portalLabel(portalKey)}`.trim();
  }

  function getLabelLeadingText(label) {
    let text = '';
    for (const node of label.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) break;
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function setLabelLeadingText(label, text) {
    const nodes = [...label.childNodes];
    const firstElementIndex = nodes.findIndex((node) => node.nodeType === Node.ELEMENT_NODE);
    nodes.forEach((node, index) => {
      if (node.nodeType === Node.TEXT_NODE && (firstElementIndex < 0 || index < firstElementIndex)) {
        label.removeChild(node);
      }
    });
    const firstElement = label.firstElementChild;
    const textNode = document.createTextNode(text);
    if (firstElement) label.insertBefore(textNode, firstElement);
    else label.appendChild(textNode);
  }

  function applyAttributes(root = document) {
    root.querySelectorAll('label[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const fallback = getLabelLeadingText(el) || el.textContent.replace(/\s+/g, ' ').trim();
      setLabelLeadingText(el, t(key, fallback));
    });

    root.querySelectorAll('[data-i18n]:not(label)').forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const value = t(key, el.textContent);
      if (el.dataset.i18nHtml === 'true') el.innerHTML = value;
      else el.textContent = value;
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder, el.placeholder);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle, el.title);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel, el.getAttribute('aria-label') || ''));
    });

    root.querySelectorAll('[data-loading-label]').forEach((el) => {
      const key = el.dataset.loadingLabelKey || 'pdf.generating';
      el.dataset.loadingLabel = t(key, el.dataset.loadingLabel || 'Generating PDF…');
    });
  }

  function applyBranding() {
    if (!branding) return;
    const lang = getLanguage();
    const name = lang === 'en' ? branding.nameEn : branding.nameBn;
    const shortMark = lang === 'en' ? branding.shortMarkEn : branding.shortMarkBn;
    const tagline = lang === 'en' ? branding.taglineEn : branding.taglineBn;
    const loginSubtitle = lang === 'en' ? branding.loginSubtitleEn : branding.loginSubtitleBn;

    document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = name; });
    document.querySelectorAll('[data-brand-mark]').forEach((el) => { el.textContent = shortMark; });
    document.querySelectorAll('[data-brand-tagline]').forEach((el) => {
      const portal = el.dataset.brandPortal;
      el.textContent = portal ? portalLabel(portal) : tagline;
    });
    document.querySelectorAll('[data-brand-login-subtitle]').forEach((el) => { el.textContent = loginSubtitle; });
    document.querySelectorAll('[data-brand-eyebrow]').forEach((el) => {
      el.textContent = eyebrowText(el.dataset.brandPortal || 'ceo');
    });
    document.querySelectorAll('[data-page-title]').forEach(() => {
      const suffix = document.querySelector('title')?.dataset.pageTitle || document.title.split(' - ')[0];
      document.title = pageTitle(suffix);
    });

    document.querySelectorAll('[data-language-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', lang === 'bn' ? 'true' : 'false');
      button.textContent = lang === 'bn' ? 'EN' : 'বাং';
      button.title = lang === 'bn' ? t('common.switchToEnglish') : t('common.switchToBengali');
      button.setAttribute('aria-label', t('common.switchLanguage'));
    });
  }

  function applyI18n(root = document) {
    applyAttributes(root);
    applyBranding();
  }

  function notifyReady() {
    ready = true;
    while (readyWaiters.length) readyWaiters.shift()();
  }

  function whenReady() {
    return ready ? Promise.resolve() : new Promise((resolve) => readyWaiters.push(resolve));
  }

  async function loadDictionaries() {
    const [en, bn] = await Promise.all([
      fetch('/static/locales/en.json').then((r) => r.json()),
      fetch('/static/locales/bn.json').then((r) => r.json()),
    ]);
    dictionaries = { en, bn };
  }

  async function loadBranding() {
    try {
      const response = await fetch(`/api/branding?lang=${encodeURIComponent(getLanguage())}`);
      branding = await response.json();
      if (!localStorage.getItem(STORAGE_KEY) && branding.defaultLanguage) {
        language = normalizeLanguage(branding.defaultLanguage);
      }
    } catch (error) {
      branding = {
        nameBn: 'বন্ধুত্বের বন্ধন ফাউন্ডেশন',
        nameEn: 'Bondhutto-er Bandhon Foundation',
        shortMarkBn: 'বব',
        shortMarkEn: 'BBF',
        taglineBn: 'সমবায় ভিত্তিক আর্থিক ব্যবস্থাপনা',
        taglineEn: 'Cooperative Financial Management',
        loginSubtitleBn: 'সদস্য ও আর্থিক ব্যবস্থাপনা প্ল্যাটফর্ম',
        loginSubtitleEn: 'Member & Financial Management Platform',
        portalLabels: DEFAULT_PORTAL_LABELS,
        defaultLanguage: 'bn',
      };
    }
  }

  function setLanguage(nextLanguage, { persist = true } = {}) {
    language = normalizeLanguage(nextLanguage);
    if (persist) localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'bn' ? 'bn' : 'en';
    applyI18n();
    document.dispatchEvent(new CustomEvent('bbbf:languagechange', { detail: { language } }));
  }

  async function init() {
    document.documentElement.lang = getLanguage() === 'bn' ? 'bn' : 'en';
    await Promise.all([loadDictionaries(), loadBranding()]);
    applyI18n();
    try {
      const response = await fetch('/api/session');
      const data = await response.json();
      if (data?.user?.preferredLanguage && !localStorage.getItem(STORAGE_KEY)) {
        setLanguage(data.user.preferredLanguage, { persist: false });
      }
    } catch (error) {
      // optional
    }
    notifyReady();
  }

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-language-toggle]');
    if (!toggle) return;
    setLanguage(getLanguage() === 'bn' ? 'en' : 'bn');
  });

  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });

  const api = {
    t,
    getLanguage,
    setLanguage,
    applyI18n,
    applyBranding,
    portalLabel,
    eyebrowText,
    pageTitle,
    whenReady,
    refresh: init,
    get branding() { return branding; },
  };

  window.I18n = api;
  window.OrganizationBranding = api;
})();
