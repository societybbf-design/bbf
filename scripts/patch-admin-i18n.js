#!/usr/bin/env node
/**
 * Adds data-i18n attributes to views/admin.html for form labels and table headers.
 * Run: node scripts/patch-admin-i18n.js
 */
const fs = require('fs');
const path = require('path');

const adminPath = path.join(__dirname, '../views/admin.html');
let html = fs.readFileSync(adminPath, 'utf8');

const tableHeaders = {
  Member: 'table.member',
  Email: 'table.email',
  Amount: 'table.amount',
  Date: 'table.date',
  Receipt: 'table.receipt',
  Name: 'table.name',
  Status: 'table.status',
  Savings: 'table.savings',
  Profit: 'table.profit',
  Profile: 'table.profile',
  Removed: 'table.removed',
  Reason: 'table.reason',
  Actions: 'table.actions',
  Action: 'table.action',
  Applications: 'table.applications',
  'Total Borrowed': 'table.totalBorrowed',
  Outstanding: 'table.outstanding',
  'Last Loan': 'table.lastLoan',
  'Last Status': 'table.lastStatus',
  'Total Repaid': 'table.totalRepaid',
  'This Month': 'table.thisMonth',
  'Last Payment': 'table.lastPayment',
  'Last Type': 'table.lastType',
  Type: 'table.type',
  'Savings / Max': 'table.savingsMax',
  Witness: 'table.witness',
  Transfer: 'table.transfer',
  Loan: 'table.loan',
  Payment: 'table.payment',
  'Investment ID': 'table.investmentId',
  Investor: 'table.investor',
  'Project Manager': 'table.projectManager',
  Location: 'table.location',
  Approved: 'table.approved',
  Pending: 'table.pending',
  Tracking: 'table.tracking',
  Invested: 'table.invested',
  'Sale Amount': 'table.saleAmount',
  'Profit / Loss': 'table.profitLoss',
  Outcome: 'table.outcome',
  'Sold Date': 'table.soldDate',
  'IOU ID': 'table.iouId',
  'Date of Birth': 'table.dateOfBirth',
  Sector: 'table.sector',
  Partner: 'table.partner',
  Sale: 'table.sale',
  Notes: 'table.notes',
  Weight: 'table.weight',
  'Dividend Share': 'table.dividendShare',
  'Current Profit': 'table.currentProfit',
  'Total Amount': 'table.totalAmount',
  Members: 'table.members',
  'Sale ID': 'table.saleId',
  'Product / Project': 'table.productProject',
  'Total Invested': 'table.totalInvested',
  Costs: 'table.costs',
  Tax: 'table.tax',
  'Net P/L': 'table.netPL',
  When: 'table.when',
  Actor: 'table.actor',
  Target: 'table.target',
  Details: 'table.details',
  Phone: 'table.phone',
  Role: 'table.role',
  Permissions: 'table.permissions',
  Document: 'table.document',
  'Recent Loan Requests': 'table.recentLoanRequests',
  Month: 'table.month',
  'Set by': 'table.setBy',
};

const sections = {
  'Society Finances': 'admin.sections.societyFinances',
  'Live Snapshot': 'admin.sections.liveSnapshot',
  'Dashboard Menu': 'admin.sections.dashboardMenu',
  Members: 'admin.sections.members',
  'Month-wise fixed contribution target': 'admin.sections.monthWiseTarget',
  'Record Deposit': 'admin.sections.recordDeposit',
  'Recent Deposits': 'admin.sections.recentDeposits',
  'Members List': 'admin.sections.membersList',
  'Member Roster': 'admin.sections.memberRoster',
  'Deleted Members': 'admin.sections.deletedMembers',
  'Loan Control Center': 'admin.sections.loanControlCenter',
  'All Loan Takers': 'admin.sections.allLoanTakers',
  'Active Borrowers': 'admin.sections.activeBorrowers',
  'Loan Review Control': 'admin.sections.loanReviewControl',
  'Loan Applications': 'admin.sections.loanApplications',
  'Loan Repayment Verification': 'admin.sections.loanRepaymentVerification',
  'Withdrawal Requests': 'admin.sections.withdrawalRequests',
  'Approval Workflow Queue': 'admin.sections.approvalWorkflowQueue',
  'Running Investments': 'admin.sections.runningInvestments',
  'Investor Portfolio': 'admin.sections.investorPortfolio',
  'Sold Investments': 'admin.sections.soldInvestments',
  'Investment IOUs': 'admin.sections.investmentIous',
  'Record Investment Profit': 'admin.sections.recordInvestmentProfit',
  'Record Investment Loss': 'admin.sections.recordInvestmentLoss',
  'Investment Profit &amp; Loss History': 'admin.sections.investmentProfitLossHistory',
  'Investment Profit & Loss History': 'admin.sections.investmentProfitLossHistory',
  'General Profit Distribution': 'admin.sections.generalProfitDistribution',
  'Automatic Dividend (Savings + Profit)': 'admin.sections.automaticDividend',
  'Member Profit Status': 'admin.sections.memberProfitStatus',
  'General Profit History': 'admin.sections.generalProfitHistory',
  'Sell Product / Project': 'admin.sections.sellProductProject',
  'Sell List': 'admin.sections.sellList',
  Payments: 'admin.sections.payments',
  'Financial Reports': 'admin.sections.financialReports',
  'Financial Trends': 'admin.sections.financialTrends',
  'Administrator Activity Log': 'admin.sections.administratorActivityLog',
  'Member Messages': 'admin.sections.memberMessages',
  Investors: 'admin.sections.investors',
  'Project Managers': 'admin.sections.projectManagers',
  'Users &amp; Roles Directory': 'admin.sections.usersRolesDirectory',
  'Users & Roles Directory': 'admin.sections.usersRolesDirectory',
  'Opening Balance / Historical Migration': 'admin.sections.openingBalanceMigration',
  'Member Replacement': 'admin.sections.memberReplacement',
  'Account security': 'admin.sections.accountSecurity',
  'System Settings': 'admin.sections.systemSettings',
  'Digital Notice Board': 'admin.sections.digitalNoticeBoard',
  'KYC Document Review': 'admin.sections.kycDocumentReview',
  'Edit Investment': 'admin.sections.editInvestment',
  'Add Investment IOU': 'admin.sections.addInvestmentIou',
  'New Investment': 'admin.sections.newInvestment',
  'Add New Member': 'admin.sections.addNewMember',
  'Review Loan Application': 'admin.sections.reviewLoanApplication',
  'Member Hub': 'admin.sections.memberHub',
  'Investment Receipt': 'admin.sections.investmentReceipt',
  Inbox: 'admin.sections.inbox',
  'Select a member': 'admin.sections.selectMemberChat',
  'Select a report': 'admin.sections.selectReport',
};

const formLabels = {
  'Your Notes': 'admin.forms.yourNotes',
  Month: 'admin.forms.month',
  'Fixed target amount': 'admin.forms.fixedTargetAmount',
  Notes: 'admin.forms.notes',
  'Select Member': 'admin.forms.selectMember',
  'Amount ($)': 'admin.forms.amountUsd',
  Status: 'admin.forms.status',
  'This Month': 'admin.forms.thisMonthFilter',
  Type: 'admin.forms.type',
  'Select Investor': 'admin.forms.selectInvestor',
  'Investment ID': 'admin.forms.investmentId',
  'Investor Name (auto-filled)': 'admin.forms.investorNameAuto',
  'Date of Birth (auto-filled)': 'admin.forms.dateOfBirthAuto',
  'Location (auto-filled)': 'admin.forms.locationAuto',
  'Investment Amount (auto-filled)': 'admin.forms.investmentAmountAuto',
  'Sale / Return Amount ($)': 'admin.forms.saleReturnAmount',
  'Profit Amount ($)': 'admin.forms.profitAmount',
  'Loss Amount ($)': 'admin.forms.lossAmount',
  'Total Profit Amount ($)': 'admin.forms.totalProfitAmount',
  'Dividend Pool Amount ($)': 'admin.forms.dividendPoolAmount',
  'Product / Project Name': 'admin.forms.productProjectName',
  'Investor (auto)': 'admin.forms.investorAuto',
  'Project / Property (auto)': 'admin.forms.projectPropertyAuto',
  'Total Historical Investments (auto)': 'admin.forms.totalHistoricalInvestmentsAuto',
  'Sale Amount ($)': 'admin.forms.saleAmountUsd',
  'Additional Costs ($)': 'admin.forms.additionalCosts',
  'Tax ($)': 'admin.forms.tax',
  'Net Profit / Loss (auto)': 'admin.forms.netProfitLossAuto',
  Member: 'admin.forms.member',
  'Opening Savings (Historical Deposit)': 'admin.forms.openingSavings',
  'Opening Profit (Historical)': 'admin.forms.openingProfit',
  'Departing member': 'admin.forms.departingMember',
  'Replacement member (from User Management)': 'admin.forms.replacementMember',
  'Exact settlement amount paid ($)': 'admin.forms.exactSettlementAmount',
  'Current password': 'admin.forms.currentPassword',
  'New password': 'admin.forms.newPassword',
  'Notice Title': 'admin.forms.noticeTitle',
  Author: 'admin.forms.author',
  'Notice Message': 'admin.forms.noticeMessage',
  'Investor Name': 'admin.forms.investorName',
  'Date of Birth': 'admin.forms.dateOfBirth',
  Location: 'admin.forms.location',
  'Profit Earned ($)': 'admin.forms.profitEarned',
  'Committed Amount ($)': 'admin.forms.committedAmount',
  'Notes (optional)': 'admin.forms.notesOptional',
  'Investment Type': 'admin.forms.investmentType',
  'Project Manager': 'admin.forms.projectManager',
  'Investment Amount ($)': 'admin.forms.investmentAmountUsd',
  'Full Name': 'admin.forms.fullName',
  'Phone Number': 'admin.forms.phoneNumber',
  'Email Address': 'admin.forms.emailAddress',
  'Initial Savings ($)': 'admin.forms.initialSavings',
  'Join Date': 'admin.forms.joinDate',
  'Member Status': 'admin.forms.memberStatus',
  'Profile Photo URL': 'admin.forms.profilePhotoUrl',
  'Emergency Contact': 'admin.forms.emergencyContact',
  'Address / Location': 'admin.forms.addressLocation',
  Attach: 'admin.forms.attach',
};

const buttons = {
  'Save month target': 'admin.buttons.saveMonthTarget',
  'Record Deposit': 'admin.buttons.recordDeposit',
  'Manage All': 'admin.buttons.manageAll',
  Review: 'admin.buttons.review',
  View: 'admin.buttons.view',
  'View Notifications': 'admin.buttons.viewNotifications',
  'Active Members': 'admin.tabs.activeMembers',
  'Deleted Members': 'admin.tabs.deletedMembers',
  'All Loan Takers': 'admin.tabs.allLoanTakers',
  'Active Borrowers': 'admin.tabs.activeBorrowers',
  'All Applications': 'admin.tabs.allApplications',
  Refresh: 'admin.buttons.refresh',
  '+ New Investment': 'admin.buttons.newInvestment',
  '+ Add Investment IOU': 'admin.buttons.addInvestmentIou',
  'Refresh Portfolio': 'admin.buttons.refreshPortfolio',
  'Record &amp; Distribute Profit': 'admin.buttons.recordDistributeProfit',
  'Record & Distribute Profit': 'admin.buttons.recordDistributeProfit',
  'Record &amp; Share Loss': 'admin.buttons.recordShareLoss',
  'Record & Share Loss': 'admin.buttons.recordShareLoss',
  'Distribute Profit': 'admin.buttons.distributeProfit',
  'Preview Calculation': 'admin.buttons.previewCalculation',
  'Distribute Dividend': 'admin.buttons.distributeDividend',
  'Record Sale': 'admin.buttons.recordSale',
  'Go to Profit Section': 'admin.buttons.goToProfitSection',
  'Send Message': 'admin.buttons.sendMessage',
  'Save Changes': 'admin.buttons.saveChanges',
  'Submit IOU': 'admin.buttons.submitIou',
  'Add Type': 'admin.buttons.addType',
  'Submit for Member Approval': 'admin.buttons.submitForMemberApproval',
  'Create Member': 'admin.buttons.createMember',
  'Save Opening Balances': 'admin.buttons.saveOpeningBalances',
  'Replace Member &amp; Record Entry': 'admin.buttons.replaceMemberRecordEntry',
  'Replace Member & Record Entry': 'admin.buttons.replaceMemberRecordEntry',
  'Update password': 'admin.buttons.updatePassword',
  'Publish Notice': 'admin.buttons.publishNotice',
  '← Back to Investors': 'admin.buttons.backToInvestors',
  '← Back to Project Managers': 'admin.buttons.backToProjectManagers',
  'Select a Summary': 'admin.buttons.selectSummary',
  'Investment Profit Tracking': 'admin.buttons.investmentProfitTracking',
  'Record Investment Loss': 'admin.buttons.recordInvestmentLoss',
  'Distribute Profit to All Members': 'admin.buttons.distributeProfitToAll',
  'Member Profit Status': 'admin.buttons.memberProfitStatus',
  'Send Notice': 'admin.quickActions.sendNotice',
  'Review Loans': 'admin.quickActions.reviewLoans',
  'Manage Members': 'admin.quickActions.manageMembers',
  'User Management': 'admin.quickActions.userManagement',
  'CEO Panel': 'admin.quickActions.ceoPanel',
  Logout: 'common.signOut',
  'Open PDF Now': 'pdf.openPdfNow',
  'Open in New Tab': 'pdf.openInNewTab',
  Close: 'common.close',
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function annotateTag(tag, text, key) {
  const escaped = escapeRegex(text);
  const re = new RegExp(`<${tag}([^>]*?)>\\s*${escaped}\\s*</${tag}>`, 'g');
  html = html.replace(re, (match, attrs) => {
    if (attrs.includes('data-i18n')) return match;
    return `<${tag}${attrs} data-i18n="${key}">${text}</${tag}>`;
  });
}

function annotateH2(text, key) {
  const variants = [text, text.replace(/&/g, '&amp;')];
  variants.forEach((v) => {
    const re = new RegExp(`<h2([^>]*?)>\\s*${escapeRegex(v)}\\s*</h2>`, 'g');
    html = html.replace(re, (match, attrs) => {
      if (attrs.includes('data-i18n')) return match;
      return `<h2${attrs} data-i18n="${key}">${v}</h2>`;
    });
  });
}

function annotateH3(text, key) {
  annotateTag('h3', text, key);
}

function annotateTh(text, key) {
  annotateTag('th', text, key);
}

function annotateButton(text, key) {
  const variants = [text, text.replace(/&/g, '&amp;')];
  variants.forEach((v) => {
    const re = new RegExp(`(<button[^>]*?)>\\s*${escapeRegex(v)}(\\s*<span[^>]*>[^<]*</span>)?\\s*</button>`, 'g');
    html = html.replace(re, (match, open) => {
      if (open.includes('data-i18n')) return match;
      return match.replace(open, `${open} data-i18n="${key}"`);
    });
    // buttons with only text
    const re2 = new RegExp(`(<button[^>]*?)>\\s*${escapeRegex(v)}\\s*</button>`, 'g');
    html = html.replace(re2, (match, open) => {
      if (open.includes('data-i18n')) return match;
      return match.replace(open, `${open} data-i18n="${key}"`);
    });
  });
}

function annotateSpanInButton(text, key) {
  const re = new RegExp(`(<span)(>\\s*${escapeRegex(text)}\\s*</span>)`, 'g');
  html = html.replace(re, (match, open, close) => {
    if (match.includes('data-i18n')) return match;
    return `${open} data-i18n="${key}"${close}`;
  });
}

function annotateLabels() {
  Object.entries(formLabels).forEach(([text, key]) => {
    const re = new RegExp(`(<label)(\\s[^>]*)?>\\s*${escapeRegex(text)}\\s*\\n`, 'g');
    html = html.replace(re, (match, open, attrs = '') => {
      if ((attrs || '').includes('data-i18n')) return match;
      return `${open} data-i18n="${key}"${attrs}>\n                ${text}\n`;
    });
  });
}

// Sort by length descending to match longer strings first
const sortKeys = (obj) => Object.entries(obj).sort((a, b) => b[0].length - a[0].length);

sortKeys(tableHeaders).forEach(([text, key]) => annotateTh(text, key));
sortKeys(sections).forEach(([text, key]) => {
  annotateH2(text, key);
  annotateH3(text, key);
});
annotateLabels();
sortKeys(buttons).forEach(([text, key]) => annotateButton(text, key));

// Quick action spans inside dashboard buttons
annotateSpanInButton('Send Notice', 'admin.quickActions.sendNotice');
annotateSpanInButton('Record Deposit', 'admin.buttons.recordDeposit');
annotateSpanInButton('Review Loans', 'admin.quickActions.reviewLoans');
annotateSpanInButton('Manage Members', 'admin.quickActions.manageMembers');
annotateSpanInButton('User Management', 'admin.quickActions.userManagement');
annotateSpanInButton('CEO Panel', 'admin.quickActions.ceoPanel');

// Metric labels
const metrics = {
  'Deposited This Month': 'admin.kpi.depositedThisMonth',
  'Not Deposited This Month': 'admin.kpi.notDepositedThisMonth',
  'Total Members': 'admin.kpi.totalMembers',
  'Total Deposits': 'admin.kpi.totalDeposits',
  'Total Savings': 'admin.kpi.totalSavings',
  'Total Profit': 'admin.kpi.totalProfit',
  'Total Investment': 'admin.kpi.totalInvestment',
  'Loan Takers': 'admin.kpi.loanTakers',
  'Active Borrowers': 'admin.kpi.activeBorrowers',
  'Running Investments': 'admin.kpi.runningInvestments',
  'Running Amount': 'admin.kpi.runningAmount',
  'Sold Investments': 'admin.kpi.soldInvestments',
  'Pending Loans': 'admin.kpi.pendingLoans',
  'Pending Withdrawals': 'admin.kpi.pendingWithdrawals',
  'Active Members': 'admin.kpi.activeMembers',
  'Unread Alerts': 'admin.kpi.unreadAlerts',
  'Total Outstanding': 'admin.kpi.totalOutstanding',
};
sortKeys(metrics).forEach(([text, key]) => {
  const re = new RegExp(`(<span class="metric-label")>\\s*${escapeRegex(text)}\\s*</span>`, 'g');
  html = html.replace(re, `$1 data-i18n="${key}">${text}</span>`);
  const re2 = new RegExp(`(<span class="snapshot-label")>\\s*${escapeRegex(text)}\\s*</span>`, 'g');
  html = html.replace(re2, `$1 data-i18n="${key}">${text}</span>`);
});

// Investment breakdown labels
['Total', 'Invested', 'Sold'].forEach((text) => {
  const key = `admin.kpi.breakdown${text}`;
  const re = new RegExp(`(<span class="investment-kpi-breakdown-label")>\\s*${escapeRegex(text)}\\s*</span>`, 'g');
  html = html.replace(re, `$1 data-i18n="${key}">${text}</span>`);
});

// for="dashboardNotesInput" label
html = html.replace(
  /<label for="dashboardNotesInput">Your Notes<\/label>/,
  '<label for="dashboardNotesInput" data-i18n="admin.forms.yourNotes">Your Notes</label>'
);

// Deleted Members tab with badge - handle specially
html = html.replace(
  /(<button[^>]*data-member-list-tab="deleted"[^>]*)>\s*Deleted Members/,
  '$1 data-i18n="admin.tabs.deletedMembers">Deleted Members'
);

fs.writeFileSync(adminPath, html);
const count = (html.match(/data-i18n="/g) || []).length;
console.log(`Patched admin.html — ${count} data-i18n attributes total.`);

function deepMerge(target, source) {
  Object.keys(source).forEach((key) => {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
  return target;
}

['en', 'bn'].forEach((lang) => {
  const localePath = path.join(__dirname, `../public/locales/${lang}.json`);
  const additions = JSON.parse(fs.readFileSync(path.join(__dirname, `admin-locale-${lang}.json`), 'utf8'));
  const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));
  deepMerge(locale, additions);
  fs.writeFileSync(localePath, `${JSON.stringify(locale, null, 2)}\n`);
  console.log(`Merged admin translations into ${lang}.json`);
});
