const BankLedgerEntry = require('../models/BankLedgerEntry');
const Deposit = require('../models/Deposit');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Refund = require('../models/Refund');
const { reconciliationState, ensureLedger } = require('./bankLedgerService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

const AUDIT_CATEGORIES = Object.freeze([
  { key: 'all', label: 'All transactions' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'advance_refunds', label: 'Advance refunds (lender)' },
  { key: 'project_returns', label: 'Project returns / sales' },
  { key: 'project_payouts', label: 'Project payouts' },
  { key: 'profit_distribution', label: 'Profit distributions' },
  { key: 'monthly_profit', label: 'Monthly profits' },
  { key: 'loan_repayments', label: 'Loan repayments' },
  { key: 'loan_disbursements', label: 'Loan disbursements' },
  { key: 'expenses', label: 'Operational expenses / cash-out' },
  { key: 'adjustments', label: 'Adjustments' },
  { key: 'opening', label: 'Opening balance' },
]);

const LEDGER_TYPE_TO_CATEGORY = Object.freeze({
  deposit: 'deposits',
  project_sale: 'project_returns',
  project_payout: 'project_payouts',
  profit_distribution: 'profit_distribution',
  monthly_profit: 'monthly_profit',
  loan_repayment: 'loan_repayments',
  loan_disbursement: 'loan_disbursements',
  operational_expense: 'expenses',
  office_cost: 'expenses',
  utility: 'expenses',
  miscellaneous: 'expenses',
  cash_out: 'expenses',
  adjustment: 'adjustments',
  opening: 'opening',
});

const CATEGORY_LABELS = Object.freeze(
  AUDIT_CATEGORIES.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
  }, {})
);

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
}

function buildDateRange({ from, to } = {}) {
  const range = {};
  const fromDate = parseDateInput(from, false);
  const toDate = parseDateInput(to, true);
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lte = toDate;
  return Object.keys(range).length ? range : null;
}

function ledgerEntryToTransaction(entry) {
  const category = LEDGER_TYPE_TO_CATEGORY[entry.type] || 'adjustments';
  return {
    id: String(entry._id),
    source: 'bank_ledger',
    category,
    categoryLabel: CATEGORY_LABELS[category] || entry.type,
    type: entry.type,
    direction: entry.direction === 'credit' ? 'in' : 'out',
    amount: money(entry.amount),
    balanceAfter: money(entry.balanceAfter),
    description: entry.note || `${entry.type} (${entry.direction})`,
    referenceType: entry.referenceType || '',
    referenceId: entry.referenceId ? String(entry.referenceId) : null,
    actor: entry.createdBy || '—',
    occurredAt: entry.createdAt,
  };
}

function withdrawalToTransaction(request) {
  const member = request.member || {};
  return {
    id: String(request._id),
    source: 'withdrawal',
    category: 'withdrawals',
    categoryLabel: CATEGORY_LABELS.withdrawals,
    type: 'withdrawal',
    direction: 'out',
    amount: money(request.amount),
    balanceAfter: null,
    description: request.reason
      ? `Withdrawal — ${request.reason}`
      : `Withdrawal processed for ${member.name || 'member'}`,
    referenceType: 'WithdrawalRequest',
    referenceId: String(request._id),
    actor: 'Cashier',
    partyName: member.name || '',
    partyEmail: member.email || '',
    occurredAt: request.updatedAt || request.createdAt,
  };
}

function refundToTransaction(refund) {
  const member = refund.member || {};
  return {
    id: String(refund._id),
    source: 'refund',
    category: 'refunds',
    categoryLabel: CATEGORY_LABELS.refunds,
    type: 'refund',
    direction: 'out',
    amount: money(refund.amount),
    balanceAfter: null,
    description: refund.reason
      ? `Refund — ${refund.reason}`
      : `Refund to ${member.name || 'member'}`,
    referenceType: 'Refund',
    referenceId: String(refund._id),
    actor: refund.recordedBy || 'Cashier',
    partyName: member.name || '',
    partyEmail: member.email || '',
    occurredAt: refund.updatedAt || refund.createdAt,
  };
}

/**
 * Borrow repayments that instantly credit the original lender's advance balance.
 * Included even when bank credit was skipped (loan path already booked cash once).
 */
function advanceRefundDepositToTransaction(deposit) {
  const member = deposit.member || {};
  return {
    id: String(deposit._id),
    source: 'deposit',
    category: 'advance_refunds',
    categoryLabel: CATEGORY_LABELS.advance_refunds,
    type: 'borrow_repayment',
    direction: 'in',
    amount: money(deposit.amount),
    balanceAfter: null,
    description: deposit.notes
      || `Advance refund / borrow repayment from ${member.name || 'member'}`,
    referenceType: 'Deposit',
    referenceId: String(deposit._id),
    actor: deposit.recordedBy || 'Cashier',
    partyName: member.name || '',
    partyEmail: member.email || '',
    occurredAt: deposit.createdAt,
  };
}

function matchesCategory(transaction, category) {
  if (!category || category === 'all') return true;
  return transaction.category === category;
}

function summarizeTransactions(transactions) {
  const summary = {
    totalIn: 0,
    totalOut: 0,
    net: 0,
    count: transactions.length,
    byCategory: {},
  };

  for (const tx of transactions) {
    if (tx.direction === 'in') {
      summary.totalIn = money(summary.totalIn + tx.amount);
    } else {
      summary.totalOut = money(summary.totalOut + tx.amount);
    }

    if (!summary.byCategory[tx.category]) {
      summary.byCategory[tx.category] = {
        category: tx.category,
        label: tx.categoryLabel,
        count: 0,
        totalIn: 0,
        totalOut: 0,
      };
    }
    const bucket = summary.byCategory[tx.category];
    bucket.count += 1;
    if (tx.direction === 'in') {
      bucket.totalIn = money(bucket.totalIn + tx.amount);
    } else {
      bucket.totalOut = money(bucket.totalOut + tx.amount);
    }
  }

  summary.net = money(summary.totalIn - summary.totalOut);
  summary.byCategory = Object.values(summary.byCategory);
  return summary;
}

async function queryAuditTransactions({
  from,
  to,
  category = 'all',
  limit = 100,
  offset = 0,
} = {}) {
  const dateRange = buildDateRange({ from, to });
  const createdAtFilter = dateRange ? { createdAt: dateRange } : {};
  const updatedAtFilter = dateRange ? { updatedAt: dateRange } : {};

  const includeLedger = !category || category === 'all'
    || Object.values(LEDGER_TYPE_TO_CATEGORY).includes(category);
  const includeWithdrawals = !category || category === 'all' || category === 'withdrawals';
  const includeRefunds = !category || category === 'all' || category === 'refunds';
  const includeAdvanceRefunds = !category || category === 'all' || category === 'advance_refunds';

  const [ledgerEntries, withdrawals, refunds, advanceRefundDeposits, ledger] = await Promise.all([
    includeLedger
      ? BankLedgerEntry.find(createdAtFilter).sort({ createdAt: -1 }).lean()
      : [],
    includeWithdrawals
      ? WithdrawalRequest.find({ status: 'processed', ...updatedAtFilter })
        .populate('member', 'name email')
        .sort({ updatedAt: -1 })
        .lean()
      : [],
    includeRefunds
      ? Refund.find({ status: 'completed', ...updatedAtFilter })
        .populate('member', 'name email')
        .sort({ updatedAt: -1 })
        .lean()
      : [],
    includeAdvanceRefunds
      ? Deposit.find({ type: 'borrow_repayment', ...createdAtFilter })
        .populate('member', 'name email')
        .sort({ createdAt: -1 })
        .lean()
      : [],
    ensureLedger(),
  ]);

  const allMapped = [
    ...ledgerEntries.map(ledgerEntryToTransaction),
    ...withdrawals.map(withdrawalToTransaction),
    ...refunds.map(refundToTransaction),
    ...advanceRefundDeposits.map(advanceRefundDepositToTransaction),
  ];

  let transactions = allMapped
    .filter((tx) => matchesCategory(tx, category))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  const totalMatched = transactions.length;
  const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const normalizedOffset = Math.max(Number(offset) || 0, 0);
  transactions = transactions.slice(normalizedOffset, normalizedOffset + normalizedLimit);

  return {
    categories: AUDIT_CATEGORIES,
    filters: {
      from: from || null,
      to: to || null,
      category,
      limit: normalizedLimit,
      offset: normalizedOffset,
    },
    ledger: reconciliationState(ledger),
    summary: summarizeTransactions(
      allMapped.filter((tx) => matchesCategory(tx, category))
    ),
    transactions,
    totalMatched,
    hasMore: normalizedOffset + transactions.length < totalMatched,
  };
}

async function getMemberLedgerDocumentData(memberId) {
  const { getMemberProfileData } = require('./memberService');
  const WithdrawalModel = require('../models/WithdrawalRequest');

  const profile = await getMemberProfileData(memberId);
  const withdrawals = await WithdrawalModel.find({ member: memberId, status: 'processed' })
    .sort({ updatedAt: -1 })
    .lean();

  const transactions = [
    ...(profile.deposits || []).map((deposit) => ({
      date: deposit.createdAt,
      type: deposit.type || 'regular',
      direction: 'in',
      amount: money(deposit.amount),
      month: deposit.yearMonth || '—',
      notes: deposit.notes || '',
      referenceId: String(deposit._id),
    })),
    ...(profile.refunds || [])
      .filter((refund) => refund.status === 'completed')
      .map((refund) => ({
        date: refund.updatedAt || refund.createdAt,
        type: 'refund',
        direction: 'out',
        amount: money(refund.amount),
        month: '—',
        notes: refund.reason || '',
        referenceId: String(refund._id),
      })),
    ...withdrawals.map((request) => ({
      date: request.updatedAt || request.createdAt,
      type: 'withdrawal',
      direction: 'out',
      amount: money(request.amount),
      month: '—',
      notes: request.reason || '',
      referenceId: String(request._id),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    ...profile,
    withdrawals,
    transactions,
    documentType: 'member',
  };
}

async function getInvestorLedgerDocumentData(investorId) {
  const { getInvestorPortfolio } = require('./investmentService');
  const portfolio = await getInvestorPortfolio(investorId);

  const transactions = (portfolio.investments || []).map((investment) => ({
    date: investment.createdAt,
    code: investment.investmentCode || '—',
    type: investment.investmentType || investment.sector || 'Investment',
    status: investment.status || '—',
    amount: money(investment.amount),
    profit: money(investment.profit || 0),
    withdrawals: money(investment.withdrawals || 0),
    netBalance: money(
      Math.max(Number(investment.amount || 0) + Number(investment.profit || 0) - Number(investment.withdrawals || 0), 0)
    ),
    referenceId: String(investment._id),
  }));

  return {
    ...portfolio,
    transactions,
    documentType: 'investor',
  };
}

module.exports = {
  AUDIT_CATEGORIES,
  CATEGORY_LABELS,
  queryAuditTransactions,
  summarizeTransactions,
  getMemberLedgerDocumentData,
  getInvestorLedgerDocumentData,
};
