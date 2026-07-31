const { formatMoney } = require('./moneyFormat');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { formatInvestmentProfitWindow } = require('./societyConfig');
const {
  brandingEmailFromFallback,
  drawPdfOrganizationHeader,
  getOrganizationSettings,
  usePdfLatinFont,
  writePdfMoney,
  writePdfLabeledMoney,
  preparePdfDocument,
  writePdfMixedText,
} = require('./organizationBranding');
const {
  createPdfBuffer,
  drawBrandHeader,
  drawSummaryCards,
  drawSectionTitle,
  drawDataTable,
  drawKeyValueTable,
  addPageNumbers,
  money: pdfMoney,
  formatDate: pdfFormatDate,
} = require('./documentPdfService');

let cachedTransporter = null;
let emailUnavailable = false;

function getTlsOptions() {
  return {
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'true',
  };
}

async function createTransporter() {
  if (emailUnavailable) {
    return null;
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: getTlsOptions(),
    });
    return cachedTransporter;
  }

  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      tls: getTlsOptions(),
    });

    cachedTransporter.testAccount = testAccount;
    return cachedTransporter;
  } catch (error) {
    emailUnavailable = true;
    console.warn('Email service unavailable. Deposits will still work without email receipts:', error.message);
    return null;
  }
}

function createReceiptPdf(member, deposit, adminName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    preparePdfDocument(doc);
    const buffers = [];
    const { paymentChannelLabel } = require('./paymentChannelService');

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const receiptNumber = deposit.receiptNumber || `DEP-${String(deposit._id || '').slice(-8).toUpperCase()}`;
    const channelLabel = paymentChannelLabel(deposit.paymentMethod || 'cash');

    const settings = getOrganizationSettings();
    preparePdfDocument(doc);

    drawPdfOrganizationHeader(doc, {
      title: 'Official Receipt',
      subtitle: 'Digital money receipt / invoice',
      align: 'center',
      titleSize: 16,
      issuerSize: 18,
    });
    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Transaction ID: ${receiptNumber}`);
    doc.text(`Member: ${member.name}`);
    doc.text(`Email: ${member.email}`);
    doc.text(`Recorded by: ${adminName}`);
    doc.text(`Date: ${deposit.createdAt.toISOString().slice(0, 10)}`);
    doc.text(`Payment channel: ${channelLabel}`);
    if (deposit.paymentReference) {
      doc.text(`Payment reference: ${deposit.paymentReference}`);
    }
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(14).fillColor('#111827');
    writePdfLabeledMoney(doc, 'Amount: ', deposit.amount, { digits: 2 });
    if (deposit.type && deposit.type !== 'regular') {
      doc.fontSize(11).fillColor('#374151').text(`Type: ${deposit.type}`);
    }
    if (deposit.yearMonth) {
      doc.text(`Contribution month: ${deposit.yearMonth}`);
    }
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(12).fillColor('#374151').text(`This official digital receipt confirms that the payment has been recorded in the ${settings.nameEn} ledger.`);
    doc.end();
  });
}

function createInvestmentReceiptPdf(investment, adminName = 'Admin') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    preparePdfDocument(doc);
    const buffers = [];
    const amount = Number(investment.amount || 0);
    const profit = Number(investment.profit || 0);
    const withdrawals = Number(investment.withdrawals || 0);
    const netBalance = Math.max(amount + profit - withdrawals, 0);
    const investmentCode = investment.investmentCode || String(investment._id || '');
    const investorName = investment.investorName || investment.partner || 'N/A';
    const investorLocation = investment.location || investment.sector || 'N/A';
    const dateOfBirth = investment.dateOfBirth
      ? new Date(investment.dateOfBirth).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      : 'N/A';
    const investmentDate = new Date(investment.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(24).fillColor('#312e81').text(investmentCode, { align: 'center' });
    doc.fontSize(11).fillColor('#64748b').text('Investment ID', { align: 'center' });
    doc.moveDown(1.2);
    doc.fontSize(20).fillColor('#0f172a').text('Society Investment Receipt', { align: 'center' });
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Investor Name: ${investorName}`);
    doc.text(`Date of Birth: ${dateOfBirth}`);
    doc.text(`Location: ${investorLocation}`);
    doc.text(`Investment Date: ${investmentDate}`);
    doc.text(`Record Profit Between: ${formatInvestmentProfitWindow(investment.createdAt)} (10-12 months)`);
    doc.text(`Recorded By: ${investment.createdBy || adminName}`);
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(14).fillColor('#111827');
    writePdfLabeledMoney(doc, 'Investment Amount: ', amount, { digits: 2 });
    doc.moveDown(1);
    doc.fontSize(13).fillColor('#0f766e').text('Profit Details', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    writePdfLabeledMoney(doc, 'Profit Earned From This Investment: ', profit, { digits: 2 });
    writePdfLabeledMoney(doc, 'Withdrawals From This Investment: ', withdrawals, { digits: 2 });
    writePdfLabeledMoney(doc, 'Current Net Balance: ', netBalance, { digits: 2 });
    doc.moveDown(1);
    doc.text(`Notes: ${investment.notes || 'N/A'}`);
    doc.moveDown(1);
    doc.text('Keep this Investment ID. Record profit in the Profit section after 10-12 months using this code.');
    doc.end();
  });
}

function createIouReceiptPdf(iou, adminName = 'Admin') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    preparePdfDocument(doc);
    const buffers = [];
    const amount = Number(iou.amount || 0);
    const iouCode = iou.iouCode || String(iou._id || '');
    const investorName = iou.investorName || 'N/A';
    const investorLocation = iou.location || 'N/A';
    const dateOfBirth = iou.dateOfBirth
      ? new Date(iou.dateOfBirth).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      : 'N/A';
    const iouDate = new Date(iou.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(24).fillColor('#7c2d12').text(iouCode, { align: 'center' });
    doc.fontSize(11).fillColor('#64748b').text('Investment IOU ID', { align: 'center' });
    doc.moveDown(1.2);
    doc.fontSize(20).fillColor('#0f172a').text('Society Investment IOU', { align: 'center' });
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Investor Name: ${investorName}`);
    doc.text(`Date of Birth: ${dateOfBirth}`);
    doc.text(`Location: ${investorLocation}`);
    doc.text(`IOU Date: ${iouDate}`);
    doc.text(`Status: ${(iou.status || 'pending').toUpperCase()}`);
    doc.text(`Recorded By: ${iou.createdBy || adminName}`);
    doc.moveDown(1);
    usePdfLatinFont(doc).fontSize(14).fillColor('#111827');
    writePdfLabeledMoney(doc, 'Committed Amount: ', amount, { digits: 2 });
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Notes: ${iou.notes || 'N/A'}`);
    doc.moveDown(1);
    doc.text('This IOU records a society investment commitment. Convert to a full investment when funds are allocated.');
    doc.end();
  });
}

async function sendDepositReceipt(member, deposit, adminName) {
  const transporter = await createTransporter();
  const pdfBuffer = await createReceiptPdf(member, deposit, adminName);

  if (!transporter) {
    return { sent: false, skipped: true };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || brandingEmailFromFallback(),
    to: member.email,
    subject: 'Deposit Receipt',
    text: `Dear ${member.name},\n\nA deposit of ${formatMoney(deposit.amount, 2)} was recorded on ${deposit.createdAt.toISOString().slice(0, 10)}.\n\nThank you,\n${adminName}`,
    html: `<p>Dear ${member.name},</p><p>A deposit of <strong>${formatMoney(deposit.amount, 2)}</strong> was recorded on <strong>${deposit.createdAt.toISOString().slice(0, 10)}</strong>.</p><p>Thank you,<br />${adminName}</p>`,
    attachments: [
      {
        filename: 'deposit-receipt.pdf',
        content: pdfBuffer,
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    if (transporter.testAccount) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    return { sent: true, info };
  } catch (error) {
    console.error('Deposit receipt email failed:', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendTransactionalEmail({ to, subject, text, html }) {
  const transporter = await createTransporter();
  if (!transporter || !to) {
    return { sent: false, skipped: true };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || brandingEmailFromFallback(),
    to,
    subject,
    text,
    html: html || `<p>${text || ''}</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    if (transporter.testAccount) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    return { sent: true, info };
  } catch (error) {
    console.error('Transactional email failed:', error.message);
    return { sent: false, error: error.message };
  }
}

function formatPaymentMethodLabel(method = '') {
  const labels = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    mobile_banking: 'Mobile Banking',
    check: 'Check',
    other: 'Other',
  };
  return labels[method] || method || 'N/A';
}

function createLoanContractPdf(loan, member, adminName = 'Admin') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    preparePdfDocument(doc);
    const buffers = [];
    const amount = Number(loan.amount || 0);
    const loanType = loan.loanType === 'emergency' ? 'Emergency' : 'General';
    const applicationDate = new Date(loan.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const approvalDate = new Date(loan.approvedAt || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#0f172a').text('Cooperative Society Loan Agreement', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#64748b').text('Official Loan Contract', { align: 'center' });
    doc.moveDown(1.5);

    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Contract Reference: ${loan._id}`);
    doc.text(`Application Date: ${applicationDate}`);
    doc.text(`Approval Date: ${approvalDate}`);
    doc.text(`Approved By: ${loan.reviewedBy || adminName}`);
    doc.text(`Disbursement Method: ${formatPaymentMethodLabel(loan.paymentMethod)}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text('Borrower Details', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Name: ${member.name || 'N/A'}`);
    doc.text(`Email: ${member.email || 'N/A'}`);
    doc.text(`Phone: ${member.phone || 'N/A'}`);
    writePdfLabeledMoney(doc, 'Total deposits at application: ', Number(loan.memberSavingsAtApply || 0), { digits: 2 });
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text('Loan Terms', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Loan Type: ${loanType}`);
    writePdfLabeledMoney(doc, 'Loan Amount: ', amount, { digits: 2 });
    doc.text(`Purpose: ${loan.reason || 'N/A'}`);
    writePdfLabeledMoney(doc, 'Maximum Eligible (80% of total deposits): ', Number(loan.maxEligibleAmount || 0), { digits: 2 });
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text('Witness', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Name: ${loan.witnessName || 'N/A'}`);
    doc.text(`Phone: ${loan.witnessPhone || 'N/A'}`);
    doc.text(`Relation: ${loan.witnessRelation || 'N/A'}`);
    doc.moveDown(1.5);

    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text('Terms and Conditions:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#374151');
    doc.text('1. The borrower agrees to repay the loan amount according to the cooperative society rules through flexible repayments recorded by the Cashier.');
    doc.text('2. The loan was approved within the 80% total-deposit eligibility limit of the cooperative.');
    doc.text('3. The borrower confirms that all information and supporting documents provided are accurate.');
    doc.text('4. Failure to repay may result in deductions from savings or other actions per society bylaws.');
    doc.text('5. This contract becomes effective upon approval and disbursement by the society administration.');
    if (loan.adminNote) {
      doc.moveDown(0.5);
      doc.text(`Admin Note: ${loan.adminNote}`);
    }
    doc.moveDown(2);

    doc.fontSize(12).fillColor('#111827').text('Signatures', { underline: true });
    doc.moveDown(1.5);
    doc.text('Borrower Signature: _____________________________    Date: _______________');
    doc.moveDown(1.5);
    doc.text('Witness Signature: ______________________________    Date: _______________');
    doc.moveDown(1.5);
    doc.text(`Society Representative (${loan.reviewedBy || adminName}): _______________    Date: _______________`);
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#64748b').text('Please download, sign, and submit the signed copy to the society office.', { align: 'center' });
    doc.end();
  });
}

function createLoanRepaymentReceiptPdf({ repayment, loan, member, adminName = 'Admin' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    preparePdfDocument(doc);
    const buffers = [];
    const amount = Number(repayment.amount || 0);
    const paymentDate = new Date(repayment.approvedAt || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#0f172a').text('Loan Repayment Receipt', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#64748b').text(repayment.receiptNumber || 'Payment Receipt', { align: 'center' });
    doc.moveDown(1.5);

    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Member: ${member?.name || 'N/A'}`);
    doc.text(`Email: ${member?.email || 'N/A'}`);
    doc.text(`Payment Date: ${paymentDate}`);
    doc.text(`Verified By: ${repayment.reviewedBy || adminName}`);
    doc.text(`Payment Method: ${formatPaymentMethodLabel(repayment.paymentMethod)}`);
    doc.text(`Repayment Type: ${repayment.repaymentType === 'full' ? 'Full Payment' : 'Partial / Custom'}`);
    doc.moveDown(1);

    usePdfLatinFont(doc).fontSize(14).fillColor('#111827');
    writePdfLabeledMoney(doc, 'Amount Paid: ', amount, { digits: 2 });
    // underline applied to following latin context
    doc.moveDown(0.75);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Loan Type: ${loan?.loanType === 'emergency' ? 'Emergency' : 'General'}`);
    writePdfLabeledMoney(doc, 'Original Loan Amount: ', Number(loan?.amount || 0), { digits: 2 });
    writePdfLabeledMoney(doc, 'Balance Before Payment: ', Number(repayment.balanceBefore || 0), { digits: 2 });
    writePdfLabeledMoney(doc, 'Remaining Outstanding Loan: ', Number(repayment.balanceAfter || 0), { digits: 2 });
    if (repayment.memberNote) {
      doc.text(`Member Note: ${repayment.memberNote}`);
    }
    doc.moveDown(1.5);
    doc.fontSize(11).fillColor('#64748b').text('This digital receipt confirms that the loan repayment was verified and recorded by the society administration.', { align: 'center' });
    doc.end();
  });
}

function createSaleReportPdf(sale, adminName = 'Admin') {
  const saleAmount = Number(sale.saleAmount || 0);
  const totalInvestment = Number(sale.totalInvestment || 0);
  const additionalCosts = Number(sale.additionalCosts || 0);
  const tax = Number(sale.tax || 0);
  const net = Number(sale.netProfitLoss || 0);
  const outcome = sale.outcomeType || (net > 0 ? 'profit' : net < 0 ? 'loss' : 'break_even');
  const netLabel = outcome === 'loss' ? 'Net Loss' : outcome === 'profit' ? 'Net Profit' : 'Break Even';
  const lines = Array.isArray(sale.investmentLines) ? sale.investmentLines : [];

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, {
      title: 'Sale Report',
      subtitle: sale.saleCode || 'SALE',
      generatedBy: sale.recordedBy || adminName,
    });

    drawSummaryCards(doc, [
      { label: 'Sale amount', value: pdfMoney(saleAmount) },
      { label: 'Total investment', value: pdfMoney(totalInvestment) },
      { label: 'Costs + tax', value: pdfMoney(additionalCosts + tax) },
      { label: netLabel, value: pdfMoney(Math.abs(net)) },
    ]);

    drawSectionTitle(doc, 'Sale details');
    drawKeyValueTable(doc, [
      ['Product / Project', sale.productName || sale.projectLabel || '—'],
      ['Investment ID', sale.investmentCode || '—'],
      ['Investor', sale.investorName || '—'],
      ['Location', sale.location || '—'],
      ['Sector', sale.sector || '—'],
      ['Sale date', pdfFormatDate(sale.createdAt)],
      ['Notes', sale.notes || '—'],
    ]);

    if (lines.length) {
      drawSectionTitle(doc, 'Investments included');
      drawDataTable(doc, {
        columns: [
          { label: '#', width: 0.1, type: 'number', format: (_row, index) => String(index + 1) },
          { label: 'Investment ID', width: 0.45, format: (row) => row.investmentCode || '—' },
          { label: 'Amount', width: 0.45, type: 'money', format: (row) => pdfMoney(row.amount) },
        ],
        rows: lines,
      });
    }

    writePdfMixedText(
      doc,
      'Formula: Sale Amount − Total Investments − Additional Costs − Tax. This report is generated from the Sales ledger.',
      {
        size: 8.5,
        color: '#64748b',
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      }
    );
    addPageNumbers(doc);
  });
}

function createPayoutVoucherPdf(investment, ledgerEntry = null, cashierName = 'Cashier') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    preparePdfDocument(doc);
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const amount = Number(investment.amount || 0);
    const paidAt = investment.cashierProcessedAt
      ? new Date(investment.cashierProcessedAt).toLocaleString()
      : new Date().toLocaleString();

    doc.fontSize(20).fillColor('#0f172a').text(`${getOrganizationSettings().nameEn} Payment Voucher`, { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#64748b').text('Project payout from society bank ledger', { align: 'center' });
    doc.moveDown(1.2);

    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Voucher date: ${paidAt}`);
    doc.text(`Processed by: ${cashierName || investment.cashierProcessedBy || 'Cashier'}`);
    doc.text(`Investment code: ${investment.investmentCode || '—'}`);
    doc.text(`Project / type: ${investment.investmentType || investment.sector || '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(13).fillColor('#0f172a').text('Payee', { underline: true });
    doc.moveDown(0.3);
    usePdfLatinFont(doc).fontSize(12).fillColor('#1f2937');
    doc.text(`Name: ${investment.payoutReceiverName || investment.investorName || '—'}`);
    doc.text(`Role: ${investment.payoutReceiverRole || '—'}`);
    doc.text(`Email: ${investment.payoutReceiverEmail || '—'}`);
    doc.text(`Account name: ${investment.payoutAccountName || '—'}`);
    doc.text(`Account number: ${investment.payoutAccountNumber || '—'}`);
    doc.text(`Bank: ${investment.payoutBankName || '—'}`);
    doc.moveDown(0.8);

    usePdfLatinFont(doc).fontSize(14).fillColor('#111827');
    writePdfLabeledMoney(doc, 'Amount paid: ', amount, { digits: 2 });
    if (ledgerEntry) {
      doc.fontSize(11).fillColor('#374151');
      doc.text(`Ledger entry: ${ledgerEntry._id}`);
      writePdfLabeledMoney(doc, 'Book balance after: ', Number(ledgerEntry.balanceAfter || 0), { digits: 2 });
    }
    if (investment.cashierNote) {
      doc.moveDown(0.5);
      doc.text(`Note: ${investment.cashierNote}`);
    }
    doc.moveDown(1.2);
    doc.fontSize(10).fillColor('#94a3b8').text(
      'This voucher confirms a project payout deducted from the society central bank ledger.',
      { align: 'center' }
    );
    doc.end();
  });
}

function createZReportPdf(summary, generatedBy = 'Cashier') {
  const totals = summary.totals || {};
  const entries = summary.entries || [];

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, {
      title: 'Daily Cash Closing (Z-Report)',
      subtitle: `Business day: ${summary.date || '—'}`,
      generatedBy,
    });

    drawSummaryCards(doc, [
      { label: 'Total in', value: pdfMoney(totals.totalIn) },
      { label: 'Total out', value: pdfMoney(totals.totalOut) },
      { label: 'Net for day', value: pdfMoney(totals.net) },
      { label: 'Book balance', value: pdfMoney(summary.bookBalance) },
    ]);

    drawSectionTitle(doc, 'Ledger position');
    drawKeyValueTable(doc, [
      ['Book bank balance', pdfMoney(summary.bookBalance)],
      ['Last reconciled actual', summary.actualBalance != null ? pdfMoney(summary.actualBalance) : '—'],
      ['Difference', summary.difference != null ? pdfMoney(summary.difference) : '—'],
      ['Mismatch', summary.mismatched ? 'YES' : 'No'],
    ]);

    drawSectionTitle(doc, 'Daily totals');
    drawDataTable(doc, {
      columns: [
        { label: 'Category', width: 0.55, format: (row) => row.label },
        { label: 'Amount', width: 0.45, type: 'money', format: (row) => pdfMoney(row.amount) },
      ],
      rows: [
        { label: 'Deposits (cash-in)', amount: totals.deposits },
        { label: 'Project sales / returns', amount: totals.sales },
        { label: 'Monthly profits logged', amount: totals.monthlyProfits },
        { label: 'Project payouts (cash-out)', amount: totals.payouts },
        { label: 'Profit distributions', amount: totals.distributions },
        { label: 'Total in', amount: totals.totalIn },
        { label: 'Total out', amount: totals.totalOut },
        { label: 'Net for day', amount: totals.net },
      ],
    });

    drawSectionTitle(doc, 'Ledger movements');
    drawDataTable(doc, {
      columns: [
        { label: 'Time', width: 0.14, format: (row) => new Date(row.createdAt).toLocaleTimeString() },
        { label: 'Type', key: 'type', width: 0.2 },
        { label: 'Dir', key: 'direction', width: 0.1, type: 'center' },
        { label: 'Amount', width: 0.18, type: 'money', format: (row) => pdfMoney(row.amount) },
        { label: 'Balance after', width: 0.18, type: 'money', format: (row) => pdfMoney(row.balanceAfter) },
        { label: 'Note', width: 0.2, format: (row) => row.note || row.description || '—' },
      ],
      rows: entries,
      emptyText: 'No ledger movements on this day.',
    });

    addPageNumbers(doc);
  });
}

function createProfitDistributionPdf(distribution) {
  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, {
      title: 'Profit Distribution Report',
      subtitle: 'Equal split among active members',
      generatedBy: distribution.distributedBy || 'Admin',
    });

    drawSummaryCards(doc, [
      { label: 'Total amount', value: pdfMoney(distribution.totalAmount) },
      { label: 'Members', value: String(distribution.memberCount || 0) },
      { label: 'Type', value: String(distribution.distributionType || 'equal') },
      { label: 'Shares', value: String((distribution.shares || []).length) },
    ]);

    drawSectionTitle(doc, 'Distribution details');
    drawKeyValueTable(doc, [
      ['Distributed by', distribution.distributedBy || '—'],
      ['Date', pdfFormatDate(distribution.createdAt)],
      ['Notes', distribution.notes || '—'],
    ]);

    drawSectionTitle(doc, 'Member breakdown');
    drawDataTable(doc, {
      columns: [
        { label: '#', width: 0.08, type: 'number', format: (_row, index) => String(index + 1) },
        { label: 'Member', width: 0.32, format: (row) => row.memberName || 'Member' },
        { label: 'Share', width: 0.2, type: 'money', format: (row) => pdfMoney(row.amount) },
        { label: 'Previous', width: 0.2, type: 'money', format: (row) => pdfMoney(row.previousProfit) },
        { label: 'New profit', width: 0.2, type: 'money', format: (row) => pdfMoney(row.newProfit) },
      ],
      rows: distribution.shares || [],
      emptyText: 'No member shares recorded.',
    });

    addPageNumbers(doc);
  });
}

async function notifyMemberByEmailAndSms(member, { subject, message }) {
  if (!member) {
    return;
  }

  if (member.email) {
    await sendTransactionalEmail({
      to: member.email,
      subject,
      text: message,
      html: `<p>${message}</p>`,
    });
  }

  if (member.phone) {
    const { sendSms } = require('./smsService');
    await sendSms({ to: member.phone, message });
  }
}

module.exports = {
  sendDepositReceipt,
  sendTransactionalEmail,
  notifyMemberByEmailAndSms,
  generateReceiptPdf: createReceiptPdf,
  generateInvestmentReceiptPdf: createInvestmentReceiptPdf,
  generateIouReceiptPdf: createIouReceiptPdf,
  generateLoanContractPdf: createLoanContractPdf,
  generateLoanRepaymentReceiptPdf: createLoanRepaymentReceiptPdf,
  formatPaymentMethodLabel,
  generateSaleReportPdf: createSaleReportPdf,
  generatePayoutVoucherPdf: createPayoutVoucherPdf,
  generateZReportPdf: createZReportPdf,
  generateProfitDistributionPdf: createProfitDistributionPdf,
};
