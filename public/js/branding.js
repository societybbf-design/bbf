/**
 * Organization branding + Bengali/English UI labels.
 */
(function initOrganizationBranding() {
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

  let branding = null;
  let language = localStorage.getItem(STORAGE_KEY) || 'bn';

  function normalizeLanguage(value) {
    return String(value || '').toLowerCase() === 'en' ? 'en' : 'bn';
  }

  function getLanguage() {
    return normalizeLanguage(language);
  }

  function setLanguage(nextLanguage, { persist = true } = {}) {
    language = normalizeLanguage(nextLanguage);
    if (persist) localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'bn' ? 'bn' : 'en';
    applyBranding();
    document.dispatchEvent(new CustomEvent('bbbf:languagechange', { detail: { language } }));
  }

  function portalLabel(portalKey) {
    const labels = branding?.portalLabels?.[portalKey] || DEFAULT_PORTAL_LABELS[portalKey];
    if (!labels) return portalKey;
    return labels[getLanguage()] || labels.en || portalKey;
  }

  function eyebrowText(portalKey) {
    return `${branding?.name || ''} ${portalLabel(portalKey)}`.trim();
  }

  function pageTitle(suffix) {
    const name = branding?.name || '';
    return suffix ? `${suffix} - ${name}` : name;
  }

  function applyBranding() {
    if (!branding) return;
    const lang = getLanguage();
    const name = lang === 'en' ? branding.nameEn : branding.nameBn;
    const shortMark = lang === 'en' ? branding.shortMarkEn : branding.shortMarkBn;
    const tagline = lang === 'en' ? branding.taglineEn : branding.taglineBn;
    const loginSubtitle = lang === 'en' ? branding.loginSubtitleEn : branding.loginSubtitleBn;

    document.querySelectorAll('[data-brand-name]').forEach((el) => {
      el.textContent = name;
    });
    document.querySelectorAll('[data-brand-mark]').forEach((el) => {
      el.textContent = shortMark;
    });
    document.querySelectorAll('[data-brand-tagline]').forEach((el) => {
      const portal = el.dataset.brandPortal;
      el.textContent = portal ? portalLabel(portal) : tagline;
    });
    document.querySelectorAll('[data-brand-login-subtitle]').forEach((el) => {
      el.textContent = loginSubtitle;
    });
    document.querySelectorAll('[data-brand-eyebrow]').forEach((el) => {
      const portal = el.dataset.brandPortal || 'ceo';
      el.textContent = eyebrowText(portal);
    });
    document.querySelectorAll('[data-page-title]').forEach((el) => {
      const suffix = el.dataset.pageTitle || document.title.split(' - ')[0];
      document.title = pageTitle(suffix);
    });

    document.querySelectorAll('[data-language-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', lang === 'bn' ? 'true' : 'false');
      button.textContent = lang === 'bn' ? 'EN' : 'বাং';
      button.title = lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন';
    });
  }

  async function loadBranding() {
    try {
      const response = await fetch(`/api/branding?lang=${encodeURIComponent(getLanguage())}`);
      branding = await response.json();
      if (!localStorage.getItem(STORAGE_KEY) && branding.defaultLanguage) {
        language = normalizeLanguage(branding.defaultLanguage);
      }
      applyBranding();
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
      };
      applyBranding();
    }
  }

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-language-toggle]');
    if (!toggle) return;
    setLanguage(getLanguage() === 'bn' ? 'en' : 'bn');
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.lang = getLanguage() === 'bn' ? 'bn' : 'en';
    void loadBranding().then(async () => {
      try {
        const response = await fetch('/api/session');
        const data = await response.json();
        if (data?.user?.preferredLanguage) {
          setLanguage(data.user.preferredLanguage, { persist: !localStorage.getItem(STORAGE_KEY) });
        }
      } catch (error) {
        // Session lookup is optional on public pages.
      }
    });
  });

  window.OrganizationBranding = {
    getLanguage,
    setLanguage,
    portalLabel,
    eyebrowText,
    pageTitle,
    applyBranding,
    refresh: loadBranding,
    get branding() {
      return branding;
    },
  };
})();
