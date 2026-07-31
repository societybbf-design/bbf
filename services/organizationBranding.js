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

const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const BENGALI_FONT_PATH = path.join(FONTS_DIR, 'NotoSansBengali-Regular.ttf');
const DEJAVU_FONT_PATH = path.join(FONTS_DIR, 'DejaVuSans.ttf');
const DEJAVU_BOLD_FONT_PATH = path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf');
const PDF_UNICODE_FONT = 'NotoSansBengali';
const PDF_LATIN_FONT = 'DejaVuSans';
const PDF_LATIN_BOLD_FONT = 'DejaVuSans-Bold';

const {
  drawMixedTextInBox,
  selectRunFont,
  splitPdfTextRuns,
} = require('./pdfTextEngine');

function ensurePdfFontRegistry(doc) {
  if (!doc._bbbfFonts) {
    // Use null = not attempted yet. false means missing/failed; true means registered.
    doc._bbbfFonts = { latin: null, latinBold: null, bengali: null };
  }
  return doc._bbbfFonts;
}

function registerFontIfPresent(doc, key, fontName, fontPath) {
  const registry = ensurePdfFontRegistry(doc);
  if (registry[key] === true) return true;
  if (registry[key] === false) return false;
  if (!fs.existsSync(fontPath)) {
    registry[key] = false;
    return false;
  }
  try {
    doc.registerFont(fontName, fontPath);
    registry[key] = true;
    return true;
  } catch (error) {
    console.warn(`[pdf] Unable to register font ${fontName}:`, error.message);
    registry[key] = false;
    return false;
  }
}

/**
 * Register Unicode Bengali (+ ৳) font on this PDFDocument.
 * Must run per document — PDFKit fonts are not shared across docs.
 */
function registerPdfBengaliFont(doc) {
  return registerFontIfPresent(doc, 'bengali', PDF_UNICODE_FONT, BENGALI_FONT_PATH);
}

/** Register DejaVu Sans for Latin body text (and bold variant when available). */
function registerPdfLatinFont(doc) {
  const ok = registerFontIfPresent(doc, 'latin', PDF_LATIN_FONT, DEJAVU_FONT_PATH);
  registerFontIfPresent(doc, 'latinBold', PDF_LATIN_BOLD_FONT, DEJAVU_BOLD_FONT_PATH);
  return ok;
}

/** Register both Latin (DejaVu) and Bengali fonts for a document. */
function registerPdfFonts(doc) {
  const latin = registerPdfLatinFont(doc);
  const bengali = registerPdfBengaliFont(doc);
  return { latin, bengali };
}

/** Bengali + ৳ + digits (NotoSansBengali — do not use for Latin letters). */
function usePdfBodyFont(doc, { bold = false, size } = {}) {
  registerPdfFonts(doc);
  selectRunFont(doc, 'bengali', { bold, size });
  return doc;
}

/** DejaVu Sans Latin PDF font (falls back to Helvetica if unavailable). */
function usePdfLatinFont(doc, { bold = false, size } = {}) {
  registerPdfFonts(doc);
  selectRunFont(doc, 'latin', { bold, size });
  return doc;
}

/** Prepare a new PDFDocument: register fonts, default to Latin body. */
function preparePdfDocument(doc) {
  registerPdfFonts(doc);
  return usePdfLatinFont(doc, { size: 11 });
}

/**
 * Write mixed Bengali/Latin/৳ text without glyph corruption.
 * Prefer absolute x/y inside tables; flow mode uses continued runs.
 */
function writePdfMixedText(doc, text, options = {}) {
  const {
    x = null,
    y = null,
    width = null,
    size = 10,
    bold = false,
    color = null,
    align = 'left',
    continued = false,
  } = options;
  registerPdfFonts(doc);
  const fill = color || '#1f2937';
  if (color) doc.fillColor(color);

  // Prefer box drawing whenever a width is known — avoids PDFKit free-flow page spills.
  if (width != null) {
    const boxX = x != null ? x : doc.page.margins.left;
    const boxY = y != null ? y : doc.y;
    const height = drawMixedTextInBox(doc, text, boxX, boxY, width, {
      size,
      bold,
      color: fill,
      align,
    });
    if (y == null) doc.y = boxY + height + 2;
    usePdfLatinFont(doc);
    return doc;
  }

  const runs = splitPdfTextRuns(text);
  runs.forEach((run, index) => {
    selectRunFont(doc, run.font, { bold, size });
    const isLast = index === runs.length - 1;
    doc.text(run.text, {
      continued: continued || !isLast,
      align,
    });
  });
  usePdfLatinFont(doc);
  return doc;
}

/**
 * Write a BDT amount with Bengali font (৳ + digits).
 * Restores Latin font afterward so following English text stays intact.
 */
function writePdfMoney(doc, value, options = {}) {
  const { formatMoney } = require('./moneyFormat');
  const { digits = 2, continued = false, align, width, x, y, size } = options;
  const amount = formatMoney(value, digits);
  if (x != null && y != null && width != null) {
    drawMixedTextInBox(doc, amount, x, y, width, {
      size: size || 10,
      color: options.color || '#1f2937',
      align: align || 'left',
    });
    usePdfLatinFont(doc);
    return doc;
  }
  usePdfBodyFont(doc, { size });
  const textOpts = {};
  if (continued) textOpts.continued = true;
  if (align) textOpts.align = align;
  if (width != null) textOpts.width = width;
  if (x != null && y != null) {
    doc.text(amount, x, y, { ...textOpts, lineBreak: false });
  } else {
    doc.text(amount, textOpts);
  }
  usePdfLatinFont(doc);
  return doc;
}

/** Write "Label: ৳1,234.56" with DejaVu label + Bengali money glyphs. */
function writePdfLabeledMoney(doc, label, value, options = {}) {
  const { digits = 2, boldLabel = false } = options;
  usePdfLatinFont(doc, { bold: boldLabel });
  doc.text(`${String(label || '')}`, { continued: true });
  writePdfMoney(doc, value, { digits });
  return doc;
}

function drawPdfOrganizationHeader(doc, options = {}) {
  const {
    title = '',
    subtitle = '',
    align = 'left',
    titleSize = 16,
    issuerSize = 18,
  } = options;
  const settings = getOrganizationSettings();
  preparePdfDocument(doc);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  let cursorY = doc.y;

  // Bengali org name only — never mix Latin into the Bengali font call.
  cursorY += drawMixedTextInBox(doc, settings.nameBn, startX, cursorY, pageWidth, {
    size: issuerSize,
    color: '#0f766e',
    align,
    bold: false,
  });
  cursorY += 2;
  cursorY += drawMixedTextInBox(doc, settings.nameEn, startX, cursorY, pageWidth, {
    size: 10,
    bold: true,
    color: '#64748b',
    align,
  });

  if (title) {
    cursorY += 8;
    cursorY += drawMixedTextInBox(doc, title, startX, cursorY, pageWidth, {
      size: titleSize,
      bold: true,
      color: '#0f172a',
      align,
    });
  }
  if (subtitle) {
    cursorY += 4;
    cursorY += drawMixedTextInBox(doc, subtitle, startX, cursorY, pageWidth, {
      size: 10,
      color: '#64748b',
      align,
    });
  }

  doc.x = startX;
  doc.y = cursorY + 10;
  usePdfLatinFont(doc);
}

function drawPdfOrganizationFooter(doc, text) {
  const settings = getOrganizationSettings();
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const footer = text || `Official document · ${settings.nameBn}`;
  drawMixedTextInBox(
    doc,
    footer,
    doc.page.margins.left,
    doc.page.height - doc.page.margins.bottom + 10,
    pageWidth,
    { size: 8, color: '#64748b', align: 'center' }
  );
  usePdfLatinFont(doc);
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
  PDF_UNICODE_FONT,
  PDF_LATIN_FONT,
  PDF_LATIN_BOLD_FONT,
  registerPdfBengaliFont,
  registerPdfLatinFont,
  registerPdfFonts,
  usePdfBodyFont,
  usePdfLatinFont,
  writePdfMixedText,
  writePdfMoney,
  writePdfLabeledMoney,
  preparePdfDocument,
  drawPdfOrganizationHeader,
  drawPdfOrganizationFooter,
};
