const { getLedger } = require('./bankLedgerService');
const {
  queryAuditTransactions,
  AUDIT_CATEGORIES,
} = require('./transactionAuditService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

const TYPE_LABELS = Object.freeze({
  opening: 'Opening balance',
  deposit: 'Member deposit',
  project_payout: 'Project payout',
  project_sale: 'Project sale / return',
  monthly_profit: 'Monthly profit',
  profit_distribution: 'Profit distribution',
  adjustment: 'Ledger adjustment',
});

const PUBLIC_CATEGORIES = AUDIT_CATEGORIES.filter((item) => item.key !== 'adjustments');

function genericPayoutDescription(tx) {
  if (tx.category === 'withdrawals') return 'Member withdrawal processed';
  if (tx.category === 'refunds') return 'Member refund completed';
  if (tx.type === 'project_payout') return 'Investment / project payout';
  if (tx.type === 'profit_distribution') return 'Profit distributed to members';
  if (tx.type === 'monthly_profit') return 'Monthly profit credited';
  if (tx.type === 'project_sale') return 'Project sale proceeds';
  if (tx.type === 'deposit') return 'Society deposit received';
  if (tx.type === 'opening') return 'Opening bank balance';
  return tx.categoryLabel || 'Society transaction';
}

function sanitizeLedgerEntry(entry) {
  const doc = entry?.toObject ? entry.toObject() : entry;
  return {
    id: String(doc._id),
    type: doc.type,
    typeLabel: TYPE_LABELS[doc.type] || doc.type,
    direction: doc.direction,
    amount: money(doc.amount),
    balanceAfter: money(doc.balanceAfter),
    description: doc.note?.trim() || TYPE_LABELS[doc.type] || doc.type,
    occurredAt: doc.createdAt,
  };
}

function sanitizeAuditTransaction(tx) {
  const description = tx.source === 'withdrawal' || tx.source === 'refund'
    ? genericPayoutDescription(tx)
    : (tx.description || genericPayoutDescription(tx));

  return {
    id: tx.id,
    category: tx.category,
    categoryLabel: tx.categoryLabel,
    direction: tx.direction,
    amount: money(tx.amount),
    balanceAfter: tx.balanceAfter != null ? money(tx.balanceAfter) : null,
    description,
    occurredAt: tx.occurredAt,
  };
}

function sanitizeLedgerPosition(ledger) {
  return {
    bookBalance: money(ledger.bookBalance),
    openingBalance: ledger.openingBalance != null ? money(ledger.openingBalance) : null,
    hasReconciliationAlert: Boolean(ledger.mismatched),
    lastReconciledAt: ledger.lastReconciledAt || null,
    updatedAt: ledger.lastReconciledAt || null,
  };
}

async function getTransparencySummary() {
  const ledger = await getLedger({ entryLimit: 8 });
  const recentPayouts = (ledger.entries || [])
    .filter((entry) => entry.direction === 'debit')
    .slice(0, 5)
    .map(sanitizeLedgerEntry);

  const recentActivity = (ledger.entries || [])
    .slice(0, 8)
    .map(sanitizeLedgerEntry);

  return {
    ledger: sanitizeLedgerPosition(ledger),
    recentPayouts,
    recentActivity,
    readOnly: true,
  };
}

async function getTransparencyLedger({ limit = 40 } = {}) {
  const ledger = await getLedger({ entryLimit: limit });
  return {
    ledger: sanitizeLedgerPosition(ledger),
    entries: (ledger.entries || []).map(sanitizeLedgerEntry),
    readOnly: true,
  };
}

async function getTransparencyAudit(filters = {}) {
  const result = await queryAuditTransactions({
    ...filters,
    category: filters.category === 'adjustments' ? 'all' : (filters.category || 'all'),
  });

  const visible = (result.transactions || [])
    .filter((tx) => tx.category !== 'adjustments')
    .map(sanitizeAuditTransaction);

  const summary = {
    totalIn: 0,
    totalOut: 0,
    net: 0,
    count: visible.length,
  };

  for (const tx of visible) {
    if (tx.direction === 'in') summary.totalIn = money(summary.totalIn + tx.amount);
    else summary.totalOut = money(summary.totalOut + tx.amount);
  }
  summary.net = money(summary.totalIn - summary.totalOut);

  return {
    categories: PUBLIC_CATEGORIES,
    filters: result.filters,
    ledger: sanitizeLedgerPosition(result.ledger),
    summary,
    transactions: visible,
    totalMatched: visible.length,
    hasMore: Boolean(result.hasMore),
    readOnly: true,
  };
}

module.exports = {
  getTransparencySummary,
  getTransparencyLedger,
  getTransparencyAudit,
  PUBLIC_CATEGORIES,
  sanitizeLedgerEntry,
  sanitizeAuditTransaction,
};
