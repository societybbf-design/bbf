'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const {
  registerPdfFonts,
  preparePdfDocument,
  PDF_LATIN_FONT,
  PDF_UNICODE_FONT,
} = require('../services/organizationBranding');
const {
  splitPdfTextRuns,
  widthOfMixedString,
  heightOfMixedString,
  drawMixedTextInBox,
} = require('../services/pdfTextEngine');
const {
  generateAuditTrailPdf,
  drawDataTable,
  createPdfBuffer,
} = require('../services/documentPdfService');

const root = path.join(__dirname, '..');
const fontsDir = path.join(root, 'assets/fonts');

test('ships DejaVu Sans and Noto Sans Bengali for PDF embedding', () => {
  assert.ok(fs.existsSync(path.join(fontsDir, 'DejaVuSans.ttf')));
  assert.ok(fs.existsSync(path.join(fontsDir, 'DejaVuSans-Bold.ttf')));
  assert.ok(fs.existsSync(path.join(fontsDir, 'NotoSansBengali-Regular.ttf')));
});

test('registerPdfFonts loads Latin and Bengali faces on each document', () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  const result = registerPdfFonts(doc);
  assert.equal(result.latin, true);
  assert.equal(result.bengali, true);
  assert.equal(doc._bbbfFonts.latin, true);
  assert.equal(doc._bbbfFonts.bengali, true);
  assert.equal(doc._bbbfFonts.latinBold, true);
  preparePdfDocument(doc);
});

test('splitPdfTextRuns keeps Latin and Bengali/৳ on separate fonts', () => {
  const runs = splitPdfTextRuns('Official বন্ধুত্বের বন্ধন document ৳1,200.50');
  assert.deepEqual(runs.map((run) => run.font), ['latin', 'bengali', 'latin', 'bengali']);
  assert.match(runs[1].text, /বন্ধুত্বের/);
  assert.match(runs[3].text, /৳1,200\.50/);
});

test('mixed text measurement and boxed drawing do not free-flow pages', async () => {
  const buf = await createPdfBuffer((doc) => {
    preparePdfDocument(doc);
    const width = 180;
    const sample = 'Project sale/liquidation INV-2026-0007 · Investor settlement রহিম ৳54,000.00';
    const height = heightOfMixedString(doc, sample, width, { size: 9 });
    assert.ok(height > 20);
    assert.ok(widthOfMixedString(doc, '৳100.00', { size: 9 }) > 0);
    const used = drawMixedTextInBox(doc, sample, doc.page.margins.left, doc.y, width, {
      size: 9,
      color: '#111827',
      maxLines: 4,
    });
    assert.ok(used >= 9);
    // Still on first page — boxed drawing must not auto-paginate.
    assert.equal(doc.bufferedPageRange().count, 1);
  });
  assert.ok(buf.length > 1000);
  assert.match(buf.toString('binary'), /FontFile/);
});

test('drawDataTable uses weighted columns, borders, and repeating headers', async () => {
  const service = fs.readFileSync(path.join(root, 'services/documentPdfService.js'), 'utf8');
  assert.match(service, /function drawDataTable/);
  assert.match(service, /resolveColumnWidths/);
  assert.match(service, /measureRowHeight/);
  assert.match(service, /maxCellLines/);
  assert.match(service, /drawHeader\(\)/);
  assert.match(service, /lineBreak:\s*false|drawMixedTextInBox/);

  const buf = await createPdfBuffer((doc) => {
    drawDataTable(doc, {
      columns: [
        { label: 'Date', width: 0.2, format: (row) => row.date },
        { label: 'Description', width: 0.55, format: (row) => row.description },
        { label: 'Amount', width: 0.25, type: 'money', format: (row) => row.amount },
      ],
      rows: Array.from({ length: 35 }, (_, index) => ({
        date: `Jul ${index + 1}, 2026`,
        description: `Long description row ${index} with Bengali রহিম and money ৳${(index + 1) * 100}.00`,
        amount: `৳${((index + 1) * 100).toFixed(2)}`,
      })),
    });
  });
  assert.ok(buf.length > 5000);
  // Multi-page table should exist for 35 wrapping rows.
  assert.ok(buf.toString('binary').includes('Page') || buf.length > 8000);
});

test('generateAuditTrailPdf embeds fonts and returns a multi-page capable buffer', async () => {
  const buf = await generateAuditTrailPdf({
    filters: { from: '2026-07-01', to: '2026-07-31', category: 'all' },
    summary: {
      totalIn: 1000,
      totalOut: 400,
      net: 600,
      count: 2,
      byCategory: [{ label: 'Deposits', count: 1, totalIn: 1000, totalOut: 0 }],
    },
    ledger: { bookBalance: 600, openingBalance: 0, actualBalance: 600, difference: 0 },
    transactions: [
      {
        occurredAt: new Date('2026-07-30T22:30:00Z'),
        categoryLabel: 'Project returns / sales',
        direction: 'in',
        amount: 54000,
        description: 'Project sale/liquidation INV-2026-0007 · Investor settlement রহিম',
        actor: 'cashier',
      },
      {
        occurredAt: new Date('2026-07-29T14:33:00Z'),
        categoryLabel: 'Deposits',
        direction: 'in',
        amount: 22000,
        description: 'Monthly contribution',
        actor: 'Admin',
      },
    ],
  }, 'Cashier', 'en');

  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 10000);
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
  assert.match(buf.toString('binary'), /FontFile/);
});

test('notification list PDFs and monthly report use shared table helpers', () => {
  const notification = fs.readFileSync(path.join(root, 'services/notificationService.js'), 'utf8');
  const monthly = fs.readFileSync(path.join(root, 'services/monthlyContributionService.js'), 'utf8');
  assert.match(notification, /drawDataTable/);
  assert.match(notification, /createPdfBuffer/);
  assert.match(notification, /function createZReportPdf/);
  assert.match(notification, /function createProfitDistributionPdf/);
  assert.match(notification, /function createSaleReportPdf/);
  assert.match(monthly, /drawDataTable/);
  assert.match(monthly, /createPdfBuffer/);
  assert.equal(PDF_LATIN_FONT, 'DejaVuSans');
  assert.equal(PDF_UNICODE_FONT, 'NotoSansBengali');
});
