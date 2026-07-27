const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { formatInvestmentProfitWindow } = require('./societyConfig');

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
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#0f172a').text('Society Management Receipt', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Member: ${member.name}`);
    doc.text(`Email: ${member.email}`);
    doc.text(`Admin: ${adminName}`);
    doc.text(`Date: ${deposit.createdAt.toISOString().slice(0, 10)}`);
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text(`Deposit Amount: $${deposit.amount.toFixed(2)}`);
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#374151').text('Thank you for your deposit. This receipt confirms that the payment has been recorded successfully.');
    doc.end();
  });
}

function createInvestmentReceiptPdf(investment, adminName = 'Admin') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
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
    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Investor Name: ${investorName}`);
    doc.text(`Date of Birth: ${dateOfBirth}`);
    doc.text(`Location: ${investorLocation}`);
    doc.text(`Investment Date: ${investmentDate}`);
    doc.text(`Record Profit Between: ${formatInvestmentProfitWindow(investment.createdAt)} (10-12 months)`);
    doc.text(`Recorded By: ${investment.createdBy || adminName}`);
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text(`Investment Amount: $${amount.toFixed(2)}`);
    doc.moveDown(1);
    doc.fontSize(13).fillColor('#0f766e').text('Profit Details', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Profit Earned From This Investment: $${profit.toFixed(2)}`);
    doc.text(`Withdrawals From This Investment: $${withdrawals.toFixed(2)}`);
    doc.text(`Current Net Balance: $${netBalance.toFixed(2)}`);
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
    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Investor Name: ${investorName}`);
    doc.text(`Date of Birth: ${dateOfBirth}`);
    doc.text(`Location: ${investorLocation}`);
    doc.text(`IOU Date: ${iouDate}`);
    doc.text(`Status: ${(iou.status || 'pending').toUpperCase()}`);
    doc.text(`Recorded By: ${iou.createdBy || adminName}`);
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text(`Committed Amount: $${amount.toFixed(2)}`);
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
    from: process.env.EMAIL_FROM || 'Society Management <no-reply@societymanagement.com>',
    to: member.email,
    subject: 'Deposit Receipt',
    text: `Dear ${member.name},\n\nA deposit of $${deposit.amount.toFixed(2)} was recorded on ${deposit.createdAt.toISOString().slice(0, 10)}.\n\nThank you,\n${adminName}`,
    html: `<p>Dear ${member.name},</p><p>A deposit of <strong>$${deposit.amount.toFixed(2)}</strong> was recorded on <strong>${deposit.createdAt.toISOString().slice(0, 10)}</strong>.</p><p>Thank you,<br />${adminName}</p>`,
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
    from: process.env.EMAIL_FROM || 'Society Management <no-reply@societymanagement.com>',
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

    doc.fontSize(12).fillColor('#1f2937');
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
    doc.text(`Savings at Application: $${Number(loan.memberSavingsAtApply || member.savings || 0).toFixed(2)}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text('Loan Terms', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Loan Type: ${loanType}`);
    doc.text(`Loan Amount: $${amount.toFixed(2)}`);
    doc.text(`Purpose: ${loan.reason || 'N/A'}`);
    doc.text(`Maximum Eligible (80% of savings): $${Number(loan.maxEligibleAmount || 0).toFixed(2)}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text('Witness', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Name: ${loan.witnessName || 'N/A'}`);
    doc.text(`Phone: ${loan.witnessPhone || 'N/A'}`);
    doc.text(`Relation: ${loan.witnessRelation || 'N/A'}`);
    doc.moveDown(1.5);

    doc.fontSize(12).fillColor('#1f2937');
    doc.text('Terms and Conditions:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#374151');
    doc.text('1. The borrower agrees to repay the loan amount according to the cooperative society rules and repayment schedule.');
    doc.text('2. The loan was approved within the 80% savings eligibility limit of the cooperative.');
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

    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Member: ${member?.name || 'N/A'}`);
    doc.text(`Email: ${member?.email || 'N/A'}`);
    doc.text(`Payment Date: ${paymentDate}`);
    doc.text(`Verified By: ${repayment.reviewedBy || adminName}`);
    doc.text(`Payment Method: ${formatPaymentMethodLabel(repayment.paymentMethod)}`);
    doc.text(`Repayment Type: ${repayment.repaymentType === 'full' ? 'Full Payment' : 'Installment'}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#111827').text(`Amount Paid: $${amount.toFixed(2)}`, { underline: true });
    doc.moveDown(0.75);
    doc.fontSize(12).fillColor('#374151');
    doc.text(`Loan Type: ${loan?.loanType === 'emergency' ? 'Emergency' : 'General'}`);
    doc.text(`Original Loan Amount: $${Number(loan?.amount || 0).toFixed(2)}`);
    doc.text(`Balance Before Payment: $${Number(repayment.balanceBefore || 0).toFixed(2)}`);
    doc.text(`Remaining Outstanding Loan: $${Number(repayment.balanceAfter || 0).toFixed(2)}`);
    if (repayment.memberNote) {
      doc.text(`Member Note: ${repayment.memberNote}`);
    }
    doc.moveDown(1.5);
    doc.fontSize(11).fillColor('#64748b').text('This digital receipt confirms that the loan repayment was verified and recorded by the society administration.', { align: 'center' });
    doc.end();
  });
}

function createSaleReportPdf(sale, adminName = 'Admin') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const buffers = [];
    const saleAmount = Number(sale.saleAmount || 0);
    const totalInvestment = Number(sale.totalInvestment || 0);
    const additionalCosts = Number(sale.additionalCosts || 0);
    const tax = Number(sale.tax || 0);
    const net = Number(sale.netProfitLoss || 0);
    const outcome = sale.outcomeType || (net > 0 ? 'profit' : net < 0 ? 'loss' : 'break_even');
    const saleDate = new Date(sale.createdAt || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#0f172a').text('SocietyHub Sale Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#64748b').text(sale.saleCode || 'SALE', { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Product / Project: ${sale.productName || sale.projectLabel || 'N/A'}`);
    doc.text(`Project Label: ${sale.projectLabel || 'N/A'}`);
    doc.text(`Investment ID: ${sale.investmentCode || 'N/A'}`);
    doc.text(`Investor: ${sale.investorName || 'N/A'}`);
    doc.text(`Location: ${sale.location || 'N/A'}`);
    doc.text(`Sector: ${sale.sector || 'N/A'}`);
    doc.text(`Sale Date: ${saleDate}`);
    doc.text(`Recorded By: ${sale.recordedBy || adminName}`);
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#0f766e').text('Financial Breakdown', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#111827');
    doc.text(`Sale Amount (manual): $${saleAmount.toFixed(2)}`);
    doc.text(`Total Historical Investments (auto-fetched): $${totalInvestment.toFixed(2)}`);
    doc.text(`Additional Costs (manual): $${additionalCosts.toFixed(2)}`);
    doc.text(`Tax (manual): $${tax.toFixed(2)}`);
    doc.moveDown(0.6);

    const netLabel = outcome === 'loss' ? 'Net Loss' : outcome === 'profit' ? 'Net Profit' : 'Break Even';
    const netColor = outcome === 'loss' ? '#b91c1c' : outcome === 'profit' ? '#047857' : '#334155';
    doc.fontSize(14).fillColor(netColor).text(
      `${netLabel}: $${Math.abs(net).toFixed(2)}  (${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)})`
    );
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#64748b').text(
      'Formula: Sale Amount − Total Investments − Additional Costs − Tax'
    );
    doc.moveDown(1);

    const lines = Array.isArray(sale.investmentLines) ? sale.investmentLines : [];
    if (lines.length) {
      doc.fontSize(13).fillColor('#0f172a').text('Investments Included', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#374151');
      lines.forEach((line, index) => {
        doc.text(
          `${index + 1}. ${line.investmentCode || 'INV'} — $${Number(line.amount || 0).toFixed(2)}`
        );
      });
      doc.moveDown(1);
    }

    doc.fontSize(12).fillColor('#1f2937').text(`Notes: ${sale.notes || 'N/A'}`);
    doc.moveDown(1.5);
    doc.fontSize(10).fillColor('#94a3b8').text(
      'This report is generated from the Sales ledger. Historical investment totals were fetched automatically from the database at the time of sale.',
      { align: 'center' }
    );
    doc.end();
  });
}

function createPayoutVoucherPdf(investment, ledgerEntry = null, cashierName = 'Cashier') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const amount = Number(investment.amount || 0);
    const paidAt = investment.cashierProcessedAt
      ? new Date(investment.cashierProcessedAt).toLocaleString()
      : new Date().toLocaleString();

    doc.fontSize(20).fillColor('#0f172a').text('SocietyHub Payment Voucher', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#64748b').text('Project payout from society bank ledger', { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Voucher date: ${paidAt}`);
    doc.text(`Processed by: ${cashierName || investment.cashierProcessedBy || 'Cashier'}`);
    doc.text(`Investment code: ${investment.investmentCode || '—'}`);
    doc.text(`Project / type: ${investment.investmentType || investment.sector || '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(13).fillColor('#0f172a').text('Payee', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Name: ${investment.payoutReceiverName || investment.investorName || '—'}`);
    doc.text(`Role: ${investment.payoutReceiverRole || '—'}`);
    doc.text(`Email: ${investment.payoutReceiverEmail || '—'}`);
    doc.text(`Account name: ${investment.payoutAccountName || '—'}`);
    doc.text(`Account number: ${investment.payoutAccountNumber || '—'}`);
    doc.text(`Bank: ${investment.payoutBankName || '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(14).fillColor('#111827').text(`Amount paid: $${amount.toFixed(2)}`);
    if (ledgerEntry) {
      doc.fontSize(11).fillColor('#374151');
      doc.text(`Ledger entry: ${ledgerEntry._id}`);
      doc.text(`Book balance after: $${Number(ledgerEntry.balanceAfter || 0).toFixed(2)}`);
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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const totals = summary.totals || {};
    doc.fontSize(20).fillColor('#0f172a').text('SocietyHub Daily Cash Closing (Z-Report)', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#64748b').text(`Business day: ${summary.date}`, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Generated by: ${generatedBy}`);
    doc.text(`Generated at: ${new Date().toLocaleString()}`);
    doc.text(`Book bank balance: $${Number(summary.bookBalance || 0).toFixed(2)}`);
    if (summary.actualBalance !== null && summary.actualBalance !== undefined) {
      doc.text(`Last reconciled actual: $${Number(summary.actualBalance).toFixed(2)}`);
      doc.text(`Difference: $${Number(summary.difference || 0).toFixed(2)}${summary.mismatched ? ' ⚠ MISMATCH' : ''}`);
    }
    doc.moveDown(1);

    doc.fontSize(13).fillColor('#0f172a').text('Daily totals', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Deposits (cash-in): $${Number(totals.deposits || 0).toFixed(2)}`);
    doc.text(`Project sales / returns: $${Number(totals.sales || 0).toFixed(2)}`);
    doc.text(`Monthly profits logged: $${Number(totals.monthlyProfits || 0).toFixed(2)}`);
    doc.text(`Project payouts (cash-out): $${Number(totals.payouts || 0).toFixed(2)}`);
    doc.text(`Profit distributions: $${Number(totals.distributions || 0).toFixed(2)}`);
    doc.text(`Total in: $${Number(totals.totalIn || 0).toFixed(2)}`);
    doc.text(`Total out: $${Number(totals.totalOut || 0).toFixed(2)}`);
    doc.text(`Net for day: $${Number(totals.net || 0).toFixed(2)}`);
    doc.moveDown(1);

    const entries = summary.entries || [];
    if (entries.length) {
      doc.fontSize(13).fillColor('#0f172a').text('Ledger movements', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#374151');
      entries.forEach((entry, index) => {
        const when = new Date(entry.createdAt).toLocaleTimeString();
        doc.text(
          `${index + 1}. ${when} · ${entry.type} · ${entry.direction} $${Number(entry.amount).toFixed(2)} · bal $${Number(entry.balanceAfter).toFixed(2)}`
        );
      });
    } else {
      doc.fontSize(11).fillColor('#64748b').text('No ledger movements on this day.');
    }

    doc.end();
  });
}

function createProfitDistributionPdf(distribution) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#0f172a').text('SocietyHub Profit Distribution Report', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#64748b').text('Equal split among active members', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#1f2937');
    doc.text(`Distributed by: ${distribution.distributedBy || '—'}`);
    doc.text(`Date: ${new Date(distribution.createdAt || Date.now()).toLocaleString()}`);
    doc.text(`Total amount: $${Number(distribution.totalAmount || 0).toFixed(2)}`);
    doc.text(`Members: ${distribution.memberCount || 0}`);
    doc.text(`Type: ${distribution.distributionType || 'equal'}`);
    if (distribution.notes) doc.text(`Notes: ${distribution.notes}`);
    doc.moveDown(1);

    doc.fontSize(13).fillColor('#0f172a').text('Member breakdown', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#374151');
    (distribution.shares || []).forEach((share, index) => {
      doc.text(
        `${index + 1}. ${share.memberName || 'Member'} — $${Number(share.amount || 0).toFixed(2)} (profit ${Number(share.previousProfit || 0).toFixed(2)} → ${Number(share.newProfit || 0).toFixed(2)})`
      );
    });

    doc.end();
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
