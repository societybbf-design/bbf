const path = require('path');
const fs = require('fs');

const ORGANIZATION_DEFAULTS = Object.freeze({
  slug: 'default',
  nameBn: 'বন্ধুত্বের বন্ধন ফাউন্ডেশন',
  nameEn: 'Bondhutto-er Bandhon Foundation',
  shortMarkBn: 'বব',
  shortMarkEn: 'BBF',
  taglineBn: 'সমবায় ভিত্তিক আর্থিক ব্যবস্থাপনা',
  taglineEn: 'Cooperative Financial Management',
  loginSubtitleBn: 'সদস্য ও আর্থিক ব্যবস্থাপনা প্ল্যাটফর্ম',
  loginSubtitleEn: 'Member & Financial Management Platform',
  defaultLanguage: 'bn',
});

const ROLE_PORTAL_LABELS = Object.freeze({
  ceo: { bn: 'সিইও ড্যাশবোর্ড', en: 'CEO Dashboard' },
  member: { bn: 'সদস্য পোর্টাল', en: 'Member Portal' },
  cashier: { bn: 'ক্যাশিয়ার ড্যাশবোর্ড', en: 'Cashier Dashboard' },
  staff: { bn: 'স্টাফ ড্যাশবোর্ড', en: 'Staff Dashboard' },
  userManagement: { bn: 'ব্যবহারকারী ব্যবস্থাপনা', en: 'User Management' },
  ceoPanel: { bn: 'সিইও কন্ট্রোল প্যানেল', en: 'CEO Control Panel' },
  developer: { bn: 'ডেভেলপার পোর্টাল', en: 'Developer Portal' },
});

let cachedSettings = null;

function normalizeLanguage(language) {
  return String(language || '').toLowerCase() === 'en' ? 'en' : 'bn';
}

function mergeSettings(doc) {
  if (!doc) return { ...ORGANIZATION_DEFAULTS };
  return {
    ...ORGANIZATION_DEFAULTS,
    ...doc,
  };
}

function setCachedOrganizationSettings(doc) {
  cachedSettings = mergeSettings(doc);
  return cachedSettings;
}

function getOrganizationSettings() {
  return cachedSettings ? { ...cachedSettings } : { ...ORGANIZATION_DEFAULTS };
}

function getOrganizationName(language = 'bn') {
  const settings = getOrganizationSettings();
  return normalizeLanguage(language) === 'en' ? settings.nameEn : settings.nameBn;
}

function getOrganizationShortMark(language = 'bn') {
  const settings = getOrganizationSettings();
  return normalizeLanguage(language) === 'en' ? settings.shortMarkEn : settings.shortMarkBn;
}

function getOrganizationTagline(language = 'bn') {
  const settings = getOrganizationSettings();
  return normalizeLanguage(language) === 'en' ? settings.taglineEn : settings.taglineBn;
}

function getLoginSubtitle(language = 'bn') {
  const settings = getOrganizationSettings();
  return normalizeLanguage(language) === 'en' ? settings.loginSubtitleEn : settings.loginSubtitleBn;
}

function getPortalLabel(portalKey, language = 'bn') {
  const labels = ROLE_PORTAL_LABELS[portalKey];
  if (!labels) return portalKey;
  return labels[normalizeLanguage(language)];
}

function getBrandingPayload(language = 'bn') {
  const lang = normalizeLanguage(language);
  const settings = getOrganizationSettings();
  return {
    language: lang,
    slug: settings.slug,
    name: lang === 'en' ? settings.nameEn : settings.nameBn,
    nameBn: settings.nameBn,
    nameEn: settings.nameEn,
    shortMark: lang === 'en' ? settings.shortMarkEn : settings.shortMarkBn,
    shortMarkBn: settings.shortMarkBn,
    shortMarkEn: settings.shortMarkEn,
    tagline: lang === 'en' ? settings.taglineEn : settings.taglineBn,
    taglineBn: settings.taglineBn,
    taglineEn: settings.taglineEn,
    loginSubtitle: lang === 'en' ? settings.loginSubtitleEn : settings.loginSubtitleBn,
    defaultLanguage: settings.defaultLanguage || 'bn',
    portalLabels: ROLE_PORTAL_LABELS,
    pdfIssuerName: settings.nameBn,
    pdfIssuerSubtitle: settings.nameEn,
  };
}

function brandingSubjectSuffix(language = 'bn') {
  return getOrganizationName(language);
}

function brandingEmailFromFallback() {
  const settings = getOrganizationSettings();
  return `${settings.nameEn} <no-reply@bondhutto-bandhon.foundation>`;
}

const BENGALI_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansBengali-Regular.ttf');
let bengaliFontRegistered = false;

function registerPdfBengaliFont(doc) {
  if (bengaliFontRegistered) return Boolean(doc._bbbfBengaliFont);
  if (!fs.existsSync(BENGALI_FONT_PATH)) {
    doc._bbbfBengaliFont = false;
    return false;
  }
  try {
    doc.registerFont('NotoSansBengali', BENGALI_FONT_PATH);
    bengaliFontRegistered = true;
    doc._bbbfBengaliFont = true;
    return true;
  } catch (error) {
    doc._bbbfBengaliFont = false;
    return false;
  }
}

function drawPdfOrganizationHeader(doc, options = {}) {
  const {
    title = '',
    subtitle = '',
    align = 'left',
    titleSize = 18,
    issuerSize = 20,
  } = options;
  const settings = getOrganizationSettings();
  const hasBengaliFont = registerPdfBengaliFont(doc);

  if (hasBengaliFont) {
    doc.font('NotoSansBengali').fontSize(issuerSize).fillColor('#0f766e')
      .text(settings.nameBn, { align });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text(settings.nameEn, { align });
  } else {
    doc.font('Helvetica-Bold').fontSize(issuerSize).fillColor('#0f766e')
      .text(settings.nameBn, { align });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text(settings.nameEn, { align });
  }

  if (title) {
    doc.moveDown(0.35);
    doc.font('Helvetica-Bold').fontSize(titleSize).fillColor('#0f172a').text(title, { align });
  }
  if (subtitle) {
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(11).fillColor('#64748b').text(subtitle, { align });
  }
  doc.moveDown(0.5);
}

function drawPdfOrganizationFooter(doc, text) {
  const settings = getOrganizationSettings();
  const hasBengaliFont = registerPdfBengaliFont(doc);
  doc.font(hasBengaliFont ? 'NotoSansBengali' : 'Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text(text || `Official document · ${settings.nameBn}`, { align: 'center' });
}

module.exports = {
  ORGANIZATION_DEFAULTS,
  ROLE_PORTAL_LABELS,
  normalizeLanguage,
  setCachedOrganizationSettings,
  getOrganizationSettings,
  getOrganizationName,
  getOrganizationShortMark,
  getOrganizationTagline,
  getLoginSubtitle,
  getPortalLabel,
  getBrandingPayload,
  brandingSubjectSuffix,
  brandingEmailFromFallback,
  registerPdfBengaliFont,
  drawPdfOrganizationHeader,
  drawPdfOrganizationFooter,
};
