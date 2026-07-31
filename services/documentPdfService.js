const { formatMoney } = require('./moneyFormat');
const PDFDocument = require('pdfkit');
const {
  drawPdfOrganizationHeader,
  getOrganizationSettings,
  usePdfLatinFont,
  preparePdfDocument,
  writePdfMixedText,
} = require('./organizationBranding');
const {
  drawMixedTextInBox,
  heightOfMixedString,
} = require('./pdfTextEngine');
const { pdfText } = require('./i18nService');

const BRAND = {
  primary: '#0f766e',
  dark: '#0f172a',
  muted: '#64748b',
  text: '#1f2937',
  border: '#e2e8f0',
  accent: '#ecfdf5',
  rowAlt: '#f8fafc',
  white: '#ffffff',
};

const PAGE_MARGIN = 42;

function money(value) {
  return `${formatMoney(Number(value || 0), 2)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function createPdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      autoFirstPage: true,
    });
    preparePdfDocument(doc);
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    Promise.resolve(buildFn(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

function drawBrandHeader(doc, { title, subtitle, generatedBy, lang = 'bn' }) {
  const pageWidth = contentWidth(doc);
  doc.save();
  doc.rect(doc.page.margins.left, doc.page.margins.top - 10, pageWidth, 3).fill(BRAND.primary);
  doc.restore();
  doc.y = doc.page.margins.top + 2;

  drawPdfOrganizationHeader(doc, {
    title,
    subtitle,
    align: 'left',
    titleSize: 15,
    issuerSize: 16,
    lang,
  });
  writePdfMixedText(doc, `${pdfText(lang, 'generatedBy')}: ${generatedBy || 'Cashier'}`, {
    size: 9,
    color: BRAND.muted,
  });
  writePdfMixedText(doc, `${pdfText(lang, 'generatedAt')}: ${formatDate(new Date())}`, {
    size: 9,
    color: BRAND.muted,
  });
  doc.moveDown(0.7);
}

function ensureSpace(doc, height = 80) {
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  if (doc.y + height > bottom) {
    doc.addPage();
    preparePdfDocument(doc);
    return true;
  }
  return false;
}

function drawSectionTitle(doc, title) {
  ensureSpace(doc, 36);
  writePdfMixedText(doc, title, {
    size: 12,
    bold: true,
    color: BRAND.dark,
  });
  doc.moveDown(0.35);
}

function drawSummaryCards(doc, cards = []) {
  if (!cards.length) return;
  const startX = doc.page.margins.left;
  const gap = 8;
  const count = Math.min(cards.length, 4);
  const cardWidth = (contentWidth(doc) - gap * (count - 1)) / count;
  const cardHeight = 54;
  ensureSpace(doc, cardHeight + 12);
  const y = doc.y;

  cards.slice(0, count).forEach((card, index) => {
    const x = startX + index * (cardWidth + gap);
    doc.save();
    doc.roundedRect(x, y, cardWidth, cardHeight, 6).fillAndStroke(BRAND.accent, BRAND.border);
    doc.restore();
    drawMixedTextInBox(doc, String(card.label || ''), x + 10, y + 10, cardWidth - 20, {
      size: 8.5,
      color: BRAND.muted,
    });
    drawMixedTextInBox(doc, String(card.value ?? '—'), x + 10, y + 26, cardWidth - 20, {
      size: 12,
      bold: true,
      color: BRAND.dark,
    });
  });

  doc.y = y + cardHeight + 14;
}

function drawKeyValueTable(doc, rows = []) {
  const labelWidth = 150;
  const valueWidth = contentWidth(doc) - labelWidth - 8;
  rows.forEach(([label, value]) => {
    const text = value == null ? '—' : String(value);
    const height = Math.max(
      16,
      heightOfMixedString(doc, String(label), labelWidth, { size: 9.5 }),
      heightOfMixedString(doc, text, valueWidth, { size: 9.5 })
    );
    ensureSpace(doc, height + 4);
    const y = doc.y;
    drawMixedTextInBox(doc, `${label}:`, doc.page.margins.left, y, labelWidth, {
      size: 9.5,
      color: BRAND.muted,
    });
    drawMixedTextInBox(doc, text, doc.page.margins.left + labelWidth + 8, y, valueWidth, {
      size: 9.5,
      color: BRAND.text,
    });
    doc.y = y + height + 3;
  });
  doc.moveDown(0.4);
}

function resolveColumnWidths(columns, tableWidth) {
  const weights = columns.map((column) => {
    if (column.width != null) return Number(column.width) || 0;
    return 1;
  });
  const explicitTotal = columns.reduce((sum, column) => (
    column.width != null ? sum + Number(column.width) : sum
  ), 0);

  if (explicitTotal > 0.99 && explicitTotal <= 1.01) {
    return columns.map((column) => tableWidth * Number(column.width));
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || columns.length;
  return weights.map((weight) => (tableWidth * weight) / weightSum);
}

function cellAlign(column) {
  if (column.align) return column.align;
  if (column.type === 'money' || column.type === 'number') return 'right';
  if (column.type === 'center') return 'center';
  return 'left';
}

function cellValue(column, row, rowIndex = 0) {
  if (typeof column.format === 'function') {
    const formatted = column.format(row, rowIndex);
    return formatted == null ? '—' : String(formatted);
  }
  const raw = row?.[column.key];
  return raw == null || raw === '' ? '—' : String(raw);
}

/**
 * Strict column table with measured row heights, cell padding, borders,
 * and repeating headers on page breaks. Never lets PDFKit free-flow cells.
 */
function drawDataTable(doc, {
  columns,
  rows,
  emptyText = 'No records.',
  rowFontSize = 8.5,
  headerFontSize = 8,
  cellPaddingX = 5,
  cellPaddingY = 4,
  minRowHeight = 18,
  maxCellLines = 6,
} = {}) {
  if (!columns?.length) return;

  const tableLeft = doc.page.margins.left;
  const tableWidth = contentWidth(doc);
  const widths = resolveColumnWidths(columns, tableWidth);
  const lineGap = 1.3;

  const measureRowHeight = (row, rowIndex) => {
    let max = minRowHeight;
    columns.forEach((column, index) => {
      const value = cellValue(column, row, rowIndex);
      const textWidth = Math.max(12, widths[index] - cellPaddingX * 2);
      const height = heightOfMixedString(doc, value, textWidth, {
        size: rowFontSize,
        lineGap,
      });
      const capped = Math.min(height, rowFontSize * lineGap * maxCellLines);
      max = Math.max(max, capped + cellPaddingY * 2);
    });
    return max;
  };

  const drawHeader = () => {
    ensureSpace(doc, 26);
    const headerY = doc.y;
    const headerHeight = 22;
    doc.save();
    doc.rect(tableLeft, headerY, tableWidth, headerHeight).fill(BRAND.primary);
    let x = tableLeft;
    columns.forEach((column, index) => {
      drawMixedTextInBox(
        doc,
        String(column.label || ''),
        x + cellPaddingX,
        headerY + 6,
        widths[index] - cellPaddingX * 2,
        {
          size: headerFontSize,
          bold: true,
          color: BRAND.white,
          align: cellAlign(column),
          maxLines: 1,
        }
      );
      x += widths[index];
    });
    doc.restore();
    doc.y = headerY + headerHeight;
  };

  drawHeader();

  if (!rows.length) {
    ensureSpace(doc, 24);
    drawMixedTextInBox(
      doc,
      emptyText,
      tableLeft + 4,
      doc.y + 4,
      tableWidth - 8,
      { size: 9.5, color: BRAND.muted }
    );
    doc.y += 22;
    return;
  }

  rows.forEach((row, rowIndex) => {
    const rowHeight = measureRowHeight(row, rowIndex);
    const addedPage = ensureSpace(doc, rowHeight + 2);
    if (addedPage) {
      drawHeader();
    }

    const rowY = doc.y;
    doc.save();
    if (rowIndex % 2 === 0) {
      doc.rect(tableLeft, rowY, tableWidth, rowHeight).fill(BRAND.rowAlt);
    }
    doc.rect(tableLeft, rowY, tableWidth, rowHeight).stroke(BRAND.border);
    let x = tableLeft;
    columns.forEach((column, index) => {
      const width = widths[index];
      doc.moveTo(x, rowY).lineTo(x, rowY + rowHeight).stroke(BRAND.border);
      drawMixedTextInBox(
        doc,
        cellValue(column, row, rowIndex),
        x + cellPaddingX,
        rowY + cellPaddingY,
        width - cellPaddingX * 2,
        {
          size: rowFontSize,
          color: BRAND.text,
          align: cellAlign(column),
          lineGap,
          maxLines: maxCellLines,
        }
      );
      x += width;
    });
    doc.moveTo(tableLeft + tableWidth, rowY)
      .lineTo(tableLeft + tableWidth, rowY + rowHeight)
      .stroke(BRAND.border);
    doc.restore();
    doc.y = rowY + rowHeight;
  });

  doc.moveDown(0.7);
}

function addPageNumbers(doc) {
  const settings = getOrganizationSettings();
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    preparePdfDocument(doc);
    const pageWidth = contentWidth(doc);
    const footerY = doc.page.height - doc.page.margins.bottom + 12;
    const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
    const orgLabel = `Official ${settings.nameBn} document`;

    drawMixedTextInBox(doc, pageLabel, doc.page.margins.left, footerY, pageWidth * 0.35, {
      size: 8,
      color: BRAND.muted,
      align: 'left',
      maxLines: 1,
    });
    drawMixedTextInBox(
      doc,
      orgLabel,
      doc.page.margins.left + pageWidth * 0.35,
      footerY,
      pageWidth * 0.65,
      {
        size: 8,
        color: BRAND.muted,
        align: 'right',
        maxLines: 1,
      }
    );
  }
}

async function generateMemberLedgerPdf(data, generatedBy = 'Cashier', lang = 'bn') {
  return createPdfBuffer((doc) => {
    const settings = getOrganizationSettings();
    const member = data.member || {};
    drawBrandHeader(doc, {
      title: pdfText(lang, 'memberStatement'),
      subtitle: pdfText(lang, 'memberStatementSubtitle'),
      generatedBy,
      lang,
    });

    drawSummaryCards(doc, [
      { label: 'Savings', value: money(member.savings) },
      { label: 'Advance', value: money(data.advanceBalance ?? member.advanceBalance) },
      { label: 'Profit', value: money(member.profit) },
      { label: 'Lifetime deposits', value: money(data.totalDeposits) },
    ]);

    drawSectionTitle(doc, 'Member details');
    drawKeyValueTable(doc, [
      ['Name', member.name || '—'],
      ['Email', member.email || '—'],
      ['Phone', member.phone || '—'],
      ['Status', member.status || 'active'],
      ['Member ID', String(member._id || '—')],
    ]);

    const current = data.currentMonthStatus || {};
    drawSectionTitle(doc, 'Current month contribution');
    drawKeyValueTable(doc, [
      ['Month', current.monthLabel || current.yearMonth || '—'],
      ['Target', current.targetAmount != null ? money(current.targetAmount) : '—'],
      ['Paid', money(current.paidAmount)],
      ['Still due', money(current.unpaidAmount)],
      ['Surplus to advance', money(current.surplusToAdvance)],
      ['Status', current.status || '—'],
    ]);

    drawSectionTitle(doc, 'Contribution history');
    drawDataTable(doc, {
      columns: [
        { label: 'Month', width: 0.16, format: (row) => row.yearMonth || '—' },
        { label: 'Expected', width: 0.2, type: 'money', format: (row) => (row.expectedAmount != null ? money(row.expectedAmount) : '—') },
        { label: 'Paid', width: 0.2, type: 'money', format: (row) => money(row.paidAmount) },
        { label: 'Unpaid', width: 0.2, type: 'money', format: (row) => money(row.unpaidAmount) },
        { label: 'Status', key: 'status', width: 0.24 },
      ],
      rows: data.contributionDues || [],
      emptyText: 'No contribution records.',
    });

    drawSectionTitle(doc, 'Complete transaction ledger');
    drawDataTable(doc, {
      columns: [
        { label: 'Date', width: 0.14, format: (row) => formatShortDate(row.date) },
        { label: 'Type', key: 'type', width: 0.16 },
        { label: 'Direction', key: 'direction', width: 0.1, type: 'center' },
        { label: 'Amount', width: 0.16, type: 'money', format: (row) => money(row.amount) },
        { label: 'Month', key: 'month', width: 0.12 },
        { label: 'Notes', key: 'notes', width: 0.32 },
      ],
      rows: data.transactions || [],
      emptyText: 'No transactions recorded.',
    });

    ensureSpace(doc, 30);
    writePdfMixedText(
      doc,
      `This is an official financial statement of ${settings.nameBn} (${settings.nameEn}) generated for auditing and record-keeping.`,
      { size: 8.5, color: BRAND.muted, align: 'center', width: contentWidth(doc) }
    );

    addPageNumbers(doc);
  });
}

async function generateInvestorPortfolioPdf(data, generatedBy = 'Cashier', lang = 'bn') {
  return createPdfBuffer((doc) => {
    const investor = data.investor || {};
    const summary = data.summary || {};

    drawBrandHeader(doc, {
      title: pdfText(lang, 'investorStatement'),
      subtitle: pdfText(lang, 'investorStatementSubtitle'),
      generatedBy,
      lang,
    });

    drawSummaryCards(doc, [
      { label: 'Total invested', value: money(summary.totalAmount) },
      { label: 'Active amount', value: money(summary.activeAmount) },
      { label: 'Sold amount', value: money(summary.soldAmount) },
      { label: 'Projects', value: String(summary.totalInvestments || 0) },
    ]);

    drawSectionTitle(doc, 'Investor details');
    drawKeyValueTable(doc, [
      ['Name', investor.name || '—'],
      ['Email', investor.email || '—'],
      ['Phone', investor.phone || '—'],
      ['Status', investor.status || 'active'],
      ['Investor ID', String(investor._id || '—')],
    ]);

    drawSectionTitle(doc, 'Investments by type');
    drawDataTable(doc, {
      columns: [
        { label: 'Type', key: 'investmentType', width: 0.28 },
        { label: 'Count', key: 'count', width: 0.12, type: 'number' },
        { label: 'Total', width: 0.2, type: 'money', format: (row) => money(row.totalAmount) },
        { label: 'Active', width: 0.2, type: 'money', format: (row) => money(row.activeAmount) },
        { label: 'Sold', width: 0.2, type: 'money', format: (row) => money(row.soldAmount) },
      ],
      rows: data.byType || [],
      emptyText: 'No investments by type.',
    });

    drawSectionTitle(doc, 'Investment transaction history');
    drawDataTable(doc, {
      columns: [
        { label: 'Date', width: 0.12, format: (row) => formatShortDate(row.date) },
        { label: 'Code', key: 'code', width: 0.16 },
        { label: 'Type', key: 'type', width: 0.14 },
        { label: 'Status', key: 'status', width: 0.12 },
        { label: 'Amount', width: 0.15, type: 'money', format: (row) => money(row.amount) },
        { label: 'Profit', width: 0.15, type: 'money', format: (row) => money(row.profit) },
        { label: 'Net', width: 0.16, type: 'money', format: (row) => money(row.netBalance) },
      ],
      rows: data.transactions || [],
      emptyText: 'No investments recorded.',
    });

    ensureSpace(doc, 28);
    writePdfMixedText(
      doc,
      'This portfolio statement reflects all society investments linked to the investor at the time of generation.',
      { size: 8.5, color: BRAND.muted, align: 'center', width: contentWidth(doc) }
    );

    addPageNumbers(doc);
  });
}

async function generateAuditTrailPdf(auditData, generatedBy = 'Cashier', lang = 'bn') {
  return createPdfBuffer((doc) => {
    const { filters = {}, summary = {}, ledger = {}, transactions = [] } = auditData;
    const filterParts = [
      filters.from ? `From ${filters.from}` : null,
      filters.to ? `To ${filters.to}` : null,
      filters.category && filters.category !== 'all' ? `Category: ${filters.category}` : 'All categories',
    ].filter(Boolean);

    drawBrandHeader(doc, {
      title: pdfText(lang, 'auditTrail'),
      subtitle: filterParts.join(' · ') || pdfText(lang, 'auditTrailSubtitle'),
      generatedBy,
      lang,
    });

    drawSummaryCards(doc, [
      { label: 'Total in', value: money(summary.totalIn) },
      { label: 'Total out', value: money(summary.totalOut) },
      { label: 'Net flow', value: money(summary.net) },
      { label: 'Transactions', value: String(summary.count || 0) },
    ]);

    drawSectionTitle(doc, 'Bank ledger position');
    drawKeyValueTable(doc, [
      ['Book balance', money(ledger.bookBalance)],
      ['Opening balance', ledger.openingBalance != null ? money(ledger.openingBalance) : '—'],
      ['Last actual balance', ledger.actualBalance != null ? money(ledger.actualBalance) : '—'],
      ['Reconciliation difference', ledger.difference != null ? money(ledger.difference) : '—'],
    ]);

    if ((summary.byCategory || []).length) {
      drawSectionTitle(doc, 'Breakdown by category');
      drawDataTable(doc, {
        columns: [
          { label: 'Category', key: 'label', width: 0.4 },
          { label: 'Count', key: 'count', width: 0.12, type: 'number' },
          { label: 'In', width: 0.24, type: 'money', format: (row) => money(row.totalIn) },
          { label: 'Out', width: 0.24, type: 'money', format: (row) => money(row.totalOut) },
        ],
        rows: summary.byCategory,
      });
    }

    drawSectionTitle(doc, 'Transaction audit trail');
    drawDataTable(doc, {
      columns: [
        {
          label: 'Date',
          width: 0.15,
          format: (row) => formatDate(row.occurredAt),
        },
        { label: 'Category', key: 'categoryLabel', width: 0.15 },
        { label: 'Dir', key: 'direction', width: 0.07, type: 'center' },
        {
          label: 'Amount',
          width: 0.14,
          type: 'money',
          format: (row) => money(row.amount),
        },
        { label: 'Description', key: 'description', width: 0.34 },
        { label: 'Actor', key: 'actor', width: 0.15 },
      ],
      rows: transactions,
      emptyText: 'No transactions matched the selected filters.',
      maxCellLines: 5,
    });

    ensureSpace(doc, 28);
    writePdfMixedText(
      doc,
      'This audit report consolidates bank ledger movements, processed withdrawals, and completed refunds for official record-keeping.',
      { size: 8.5, color: BRAND.muted, align: 'center', width: contentWidth(doc) }
    );

    addPageNumbers(doc);
  });
}

async function generateAdvancesBorrowingsPdf(data, generatedBy = 'Cashier', lang = 'bn') {
  return createPdfBuffer((doc) => {
    const settings = getOrganizationSettings();
    drawBrandHeader(doc, {
      title: 'Advances & Borrowings Report',
      subtitle: 'Member advance balances and internal borrowing history',
      generatedBy,
      lang,
    });

    const members = data.members || [];
    const borrowings = data.borrowings || [];
    const totalAdvance = members.reduce((sum, row) => sum + Number(row.advanceBalance || 0), 0);
    const openBorrowings = borrowings.filter((row) => ['open', 'partial'].includes(row.status));
    const openOutstanding = openBorrowings.reduce(
      (sum, row) => sum + Math.max(0, Number(row.amount || 0) - Number(row.amountSettled || 0)),
      0
    );

    drawSummaryCards(doc, [
      { label: 'Members', value: String(members.length) },
      { label: 'Total advance', value: money(totalAdvance) },
      { label: 'Open borrowings', value: String(openBorrowings.length) },
      { label: 'Open outstanding', value: money(openOutstanding) },
    ]);

    drawSectionTitle(doc, 'Member advance balances');
    drawDataTable(doc, {
      columns: [
        { label: 'Member', key: 'name', width: 0.34 },
        { label: 'Savings', width: 0.22, type: 'money', format: (row) => money(row.savings) },
        { label: 'Advance', width: 0.22, type: 'money', format: (row) => money(row.advanceBalance) },
        { label: 'Profit', width: 0.22, type: 'money', format: (row) => money(row.profit) },
      ],
      rows: members,
      emptyText: 'No members.',
    });

    drawSectionTitle(doc, 'Internal borrowings history');
    drawDataTable(doc, {
      columns: [
        {
          label: 'Context',
          width: 0.2,
          format: (row) => (
            row.loan
              ? `Loan · ${row.loan?.loanType || 'member loan'}`
              : (row.investment?.investmentCode || row.note || '—')
          ),
        },
        { label: 'Borrower', width: 0.15, format: (row) => row.borrowerName || row.borrower?.name || '—' },
        { label: 'Lender', width: 0.15, format: (row) => row.lenderName || row.lender?.name || '—' },
        { label: 'Amount', width: 0.13, type: 'money', format: (row) => money(row.amount) },
        {
          label: 'Outstanding',
          width: 0.13,
          type: 'money',
          format: (row) => money(Math.max(0, Number(row.amount || 0) - Number(row.amountSettled || 0))),
        },
        { label: 'Status', key: 'status', width: 0.1 },
        { label: 'When', width: 0.14, format: (row) => formatShortDate(row.createdAt) },
      ],
      rows: borrowings,
      emptyText: 'No borrowings recorded.',
    });

    ensureSpace(doc, 28);
    writePdfMixedText(
      doc,
      `This is an official advances & borrowings report of ${settings.nameBn} (${settings.nameEn}) for auditing and record-keeping.`,
      { size: 8.5, color: BRAND.muted, align: 'center', width: contentWidth(doc) }
    );

    addPageNumbers(doc);
  });
}

module.exports = {
  money,
  formatDate,
  formatShortDate,
  createPdfBuffer,
  drawBrandHeader,
  drawSummaryCards,
  drawSectionTitle,
  drawKeyValueTable,
  drawDataTable,
  addPageNumbers,
  ensureSpace,
  generateMemberLedgerPdf,
  generateInvestorPortfolioPdf,
  generateAuditTrailPdf,
  generateAdvancesBorrowingsPdf,
};
