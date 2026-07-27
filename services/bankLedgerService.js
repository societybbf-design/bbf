const BankLedger = require('../models/BankLedger');
const BankLedgerEntry = require('../models/BankLedgerEntry');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureLedger() {
  let ledger = await BankLedger.findOne({ key: BankLedger.LEDGER_KEY });
  if (!ledger) {
    ledger = await BankLedger.create({
      key: BankLedger.LEDGER_KEY,
      openingBalance: null,
      bookBalance: 0,
    });
  }
  return ledger;
}

function reconciliationState(ledger) {
  const bookBalance = money(ledger.bookBalance);
  const hasActual = ledger.lastActualBalance !== null && ledger.lastActualBalance !== undefined;
  const actualBalance = hasActual ? money(ledger.lastActualBalance) : null;
  const difference = hasActual ? money(actualBalance - bookBalance) : null;
  return {
    bookBalance,
    actualBalance,
    difference,
    mismatched: hasActual ? Math.abs(difference) >= 0.01 : false,
    openingSet: ledger.openingBalance !== null && ledger.openingBalance !== undefined,
    openingBalance: ledger.openingBalance === null || ledger.openingBalance === undefined
      ? null
      : money(ledger.openingBalance),
    openingSetAt: ledger.openingSetAt,
    openingSetBy: ledger.openingSetBy || '',
    lastReconciledAt: ledger.lastReconciledAt,
    lastReconciledBy: ledger.lastReconciledBy || '',
  };
}

async function getLedger({ entryLimit = 40 } = {}) {
  const ledger = await ensureLedger();
  const entries = await BankLedgerEntry.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(entryLimit) || 40, 200));
  return {
    ...reconciliationState(ledger),
    entries,
  };
}

async function setOpeningBalance(amount, { userName = 'Cashier', force = false } = {}) {
  const normalized = money(amount);
  if (normalized < 0) {
    throw httpError('Opening balance cannot be negative.');
  }

  const ledger = await ensureLedger();
  if (ledger.openingBalance !== null && ledger.openingBalance !== undefined && !force) {
    throw httpError('Opening bank balance is already set. Ask a CEO to reset if needed.', 409);
  }

  ledger.openingBalance = normalized;
  ledger.openingSetAt = new Date();
  ledger.openingSetBy = userName;
  ledger.bookBalance = normalized;
  await ledger.save();

  const entry = await BankLedgerEntry.create({
    type: 'opening',
    direction: 'credit',
    amount: normalized,
    balanceAfter: normalized,
    note: 'Opening bank balance set by cashier',
    createdBy: userName,
  });

  return { ledger: reconciliationState(ledger), entry };
}

async function assertOpeningSet(ledger) {
  if (ledger.openingBalance === null || ledger.openingBalance === undefined) {
    throw httpError('Set the bank ledger opening balance before recording cash movements.', 409);
  }
}

/**
 * Ensure inbound cash (deposits / advances) can post to book balance immediately.
 * If opening was never set, bootstrap it to the current book balance (usually 0)
 * so the first deposit still updates Book Balance in real time.
 */
async function ensureOpeningForInboundCash(ledger, createdBy = 'System') {
  if (ledger.openingBalance !== null && ledger.openingBalance !== undefined) {
    return ledger;
  }
  const seed = money(ledger.bookBalance || 0);
  ledger.openingBalance = seed;
  ledger.openingSetAt = new Date();
  ledger.openingSetBy = String(createdBy || 'System').trim() || 'System';
  if (ledger.bookBalance == null) {
    ledger.bookBalance = seed;
  }
  await ledger.save();
  return ledger;
}

async function postEntry({
  type,
  direction,
  amount,
  referenceType = '',
  referenceId = null,
  note = '',
  createdBy = '',
  allowWithoutOpening = false,
}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('Ledger amount must be greater than zero.');
  }
  if (!['credit', 'debit'].includes(direction)) {
    throw httpError('Invalid ledger direction.');
  }

  let ledger = await ensureLedger();
  if (allowWithoutOpening && direction === 'credit') {
    ledger = await ensureOpeningForInboundCash(ledger, createdBy);
  } else {
    await assertOpeningSet(ledger);
  }

  const nextBalance = direction === 'credit'
    ? money(ledger.bookBalance + normalized)
    : money(ledger.bookBalance - normalized);

  if (nextBalance < -0.001) {
    throw httpError('Insufficient bank ledger balance for this debit.', 400);
  }

  ledger.bookBalance = Math.max(0, nextBalance);
  await ledger.save();

  const entry = await BankLedgerEntry.create({
    type,
    direction,
    amount: normalized,
    balanceAfter: ledger.bookBalance,
    referenceType,
    referenceId,
    note,
    createdBy,
  });

  return { ledger: reconciliationState(ledger), entry };
}

async function credit(params) {
  return postEntry({ ...params, direction: 'credit' });
}

async function debit(params) {
  return postEntry({ ...params, direction: 'debit' });
}

/**
 * Hard credit for inbound cash (member deposits, advances, project sales, monthly profits).
 * Always updates Book Balance. Bootstraps opening balance if needed so cash-in is never silently skipped.
 */
async function creditInbound(params) {
  return postEntry({ ...params, direction: 'credit', allowWithoutOpening: true });
}

/** @deprecated Prefer creditInbound — kept as alias for deposit call sites */
async function creditDeposit(params) {
  return creditInbound(params);
}

/**
 * Soft credit used by hooks: skips if opening not set (does not fail the primary business action).
 * Returns null when skipped.
 * Prefer creditInbound() for deposits, advances, project sales, and monthly profits.
 */
async function tryCredit(params) {
  try {
    const ledger = await ensureLedger();
    if (ledger.openingBalance === null || ledger.openingBalance === undefined) {
      return null;
    }
    return credit(params);
  } catch (error) {
    console.warn('[bankLedger] credit skipped:', error.message);
    return null;
  }
}

async function tryDebit(params) {
  try {
    const ledger = await ensureLedger();
    if (ledger.openingBalance === null || ledger.openingBalance === undefined) {
      return null;
    }
    return debit(params);
  } catch (error) {
    console.warn('[bankLedger] debit skipped:', error.message);
    return null;
  }
}

async function reconcile(actualBalance, { userName = 'Cashier' } = {}) {
  const normalized = money(actualBalance);
  if (Number.isNaN(normalized)) {
    throw httpError('Actual bank balance must be a number.');
  }

  const ledger = await ensureLedger();
  await assertOpeningSet(ledger);

  ledger.lastActualBalance = normalized;
  ledger.lastReconciledAt = new Date();
  ledger.lastReconciledBy = userName;
  await ledger.save();

  return reconciliationState(ledger);
}

function dayBounds(dateInput) {
  const base = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw httpError('Invalid date for Z-report.');
  }
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0);
  return { start, end, label: start.toISOString().slice(0, 10) };
}

async function getDailySummary(dateInput) {
  const { start, end, label } = dayBounds(dateInput);
  const ledger = await ensureLedger();
  const entries = await BankLedgerEntry.find({
    createdAt: { $gte: start, $lt: end },
  }).sort({ createdAt: 1 });

  let deposits = 0;
  let payouts = 0;
  let sales = 0;
  let monthlyProfits = 0;
  let distributions = 0;
  let otherCredits = 0;
  let otherDebits = 0;

  for (const entry of entries) {
    const amt = money(entry.amount);
    if (entry.direction === 'credit') {
      if (entry.type === 'deposit') deposits += amt;
      else if (entry.type === 'project_sale') sales += amt;
      else if (entry.type === 'monthly_profit') monthlyProfits += amt;
      else if (entry.type !== 'opening') otherCredits += amt;
    } else {
      if (entry.type === 'project_payout') payouts += amt;
      else if (entry.type === 'profit_distribution') distributions += amt;
      else otherDebits += amt;
    }
  }

  const totalIn = money(deposits + sales + monthlyProfits + otherCredits);
  const totalOut = money(payouts + distributions + otherDebits);

  return {
    date: label,
    bookBalance: money(ledger.bookBalance),
    ...reconciliationState(ledger),
    totals: {
      deposits: money(deposits),
      payouts: money(payouts),
      sales: money(sales),
      monthlyProfits: money(monthlyProfits),
      distributions: money(distributions),
      otherCredits: money(otherCredits),
      otherDebits: money(otherDebits),
      totalIn,
      totalOut,
      net: money(totalIn - totalOut),
    },
    entries,
  };
}

async function getEntryById(id) {
  const entry = await BankLedgerEntry.findById(id);
  if (!entry) {
    throw httpError('Ledger entry not found.', 404);
  }
  return entry;
}

module.exports = {
  money,
  ensureLedger,
  getLedger,
  setOpeningBalance,
  credit,
  debit,
  creditInbound,
  creditDeposit,
  tryCredit,
  tryDebit,
  reconcile,
  getDailySummary,
  getEntryById,
  reconciliationState,
};
