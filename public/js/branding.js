/** @deprecated Use /static/js/i18n.js — kept for backward compatibility. */
if (!window.I18n && !window.OrganizationBranding) {
  const script = document.createElement('script');
  script.src = '/static/js/i18n.js';
  document.head.appendChild(script);
}
