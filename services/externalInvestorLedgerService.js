'use strict';

const ExternalInvestorLedger = require('../models/ExternalInvestorLedger');
const ExternalInvestorLedgerEntry = require('../models/ExternalInvestorLedgerEntry');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function ensureExternalLedger(investment, session = null) {
  if (!investment?._id) {
    throw httpError('Investment is required for external ledger.', 400);
  }
  const findQ = ExternalInvestorLedger.findOne({ investment: investment._id });
  if (session) findQ.session(session);
  let ledger = await findQ;
  if (ledger) return ledger;
  const payload = {
    investment: investment._id,
    investmentCode: investment.investmentCode || '',
    bookBalance: 0,
  };
  if (session) {
    const created = await ExternalInvestorLedger.create([payload], { session });
    return created[0];
  }
  ledger = await ExternalInvestorLedger.create(payload);
  return ledger;
}

/**
 * Post an entry on the project-specific external investor sub-ledger.
 * Never touches Society BankLedger.bookBalance.
 */
async function postExternalEntry({
  investment,
  type,
  direction,
  amount,
  investor = null,
  investorName = '',
  referenceType = '',
  referenceId = null,
  note = '',
  createdBy = '',
  payoutStatus = '',
  session = null,
} = {}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('External ledger amount must be greater than zero.');
  }
  if (!['credit', 'debit'].includes(direction)) {
    throw httpError('External ledger direction must be credit or debit.');
  }

  const ledger = await ensureExternalLedger(investment, session);
  const nextBalance = direction === 'credit'
    ? money(Number(ledger.bookBalance || 0) + normalized)
    : money(Number(ledger.bookBalance || 0) - normalized);

  if (direction === 'debit' && nextBalance < -0.001) {
    throw httpError(
      `External sub-ledger has insufficient balance (${money(ledger.bookBalance)}). `
      + `Cannot debit ${normalized}.`,
      409
    );
  }

  ledger.bookBalance = nextBalance;
  if (type === 'external_capital_in') ledger.capitalIn = money(Number(ledger.capitalIn || 0) + normalized);
  if (type === 'external_capital_out') ledger.capitalOut = money(Number(ledger.capitalOut || 0) + normalized);
  if (type === 'external_profit_accrual') ledger.profitAccrued = money(Number(ledger.profitAccrued || 0) + normalized);
  if (type === 'external_profit_payout') ledger.profitPaid = money(Number(ledger.profitPaid || 0) + normalized);
  if (type === 'external_expense_share') ledger.expenseShare = money(Number(ledger.expenseShare || 0) + normalized);
  if (investment.investmentCode) ledger.investmentCode = investment.investmentCode;

  await ledger.save(session ? { session } : undefined);

  const entryPayload = {
    ledger: ledger._id,
    investment: investment._id,
    investor: investor || null,
    investorName: String(investorName || '').trim(),
    type,
    direction,
    amount: normalized,
    balanceAfter: nextBalance,
    referenceType: String(referenceType || '').trim(),
    referenceId: referenceId || null,
    note: String(note || '').trim(),
    createdBy: String(createdBy || '').trim(),
    payoutStatus: payoutStatus || '',
  };

  const [entry] = session
    ? await ExternalInvestorLedgerEntry.create([entryPayload], { session })
    : [await ExternalInvestorLedgerEntry.create(entryPayload)];

  return { ledger, entry };
}

async function creditExternalCapital(investment, amount, meta = {}) {
  return postExternalEntry({
    investment,
    type: 'external_capital_in',
    direction: 'credit',
    amount,
    ...meta,
  });
}

async function creditExternalProfitAccrual(investment, amount, meta = {}) {
  return postExternalEntry({
    investment,
    type: 'external_profit_accrual',
    direction: 'credit',
    amount,
    payoutStatus: meta.payoutStatus || '',
    ...meta,
  });
}

async function debitExternalProfitPayout(investment, amount, meta = {}) {
  return postExternalEntry({
    investment,
    type: 'external_profit_payout',
    direction: 'debit',
    amount,
    payoutStatus: meta.payoutStatus || 'paid',
    ...meta,
  });
}

async function debitExternalCapitalOut(investment, amount, meta = {}) {
  return postExternalEntry({
    investment,
    type: 'external_capital_out',
    direction: 'debit',
    amount,
    ...meta,
  });
}

async function debitExternalExpenseShare(investment, amount, meta = {}) {
  return postExternalEntry({
    investment,
    type: 'external_expense_share',
    direction: 'debit',
    amount,
    ...meta,
  });
}

async function getExternalLedgerForInvestment(investmentId) {
  const ledger = await ExternalInvestorLedger.findOne({ investment: investmentId }).lean();
  if (!ledger) {
    return { ledger: null, entries: [] };
  }
  const entries = await ExternalInvestorLedgerEntry.find({ ledger: ledger._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return { ledger, entries };
}

async function listPendingExternalPayouts() {
  return ExternalInvestorLedgerEntry.find({
    type: 'external_profit_payout',
    payoutStatus: { $in: ['pending_ceo', 'approved'] },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

module.exports = {
  money,
  ensureExternalLedger,
  postExternalEntry,
  creditExternalCapital,
  creditExternalProfitAccrual,
  debitExternalProfitPayout,
  debitExternalCapitalOut,
  debitExternalExpenseShare,
  getExternalLedgerForInvestment,
  listPendingExternalPayouts,
};
