const ProfitPool = require('../models/ProfitPool');
const ProfitDistribution = require('../models/ProfitDistribution');
const { distributeAmountToMembers } = require('./profitService');
const { creditInbound, debit: ledgerDebit, money } = require('./bankLedgerService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensurePool() {
  let pool = await ProfitPool.findOne({ key: ProfitPool.POOL_KEY });
  if (!pool) {
    pool = await ProfitPool.create({
      key: ProfitPool.POOL_KEY,
      balance: 0,
      entries: [],
    });
  }
  return pool;
}

async function getPool({ entryLimit = 30 } = {}) {
  const pool = await ensurePool();
  const entries = [...(pool.entries || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Math.min(Number(entryLimit) || 30, 100));
  const recentDistributions = await ProfitDistribution.find({})
    .sort({ createdAt: -1 })
    .limit(10);
  return {
    balance: money(pool.balance),
    entries,
    recentDistributions,
  };
}

async function logMonthlyProfit({
  amount,
  note = '',
  source = '',
  createdBy = 'Cashier',
  creditBankLedger = true,
} = {}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('Monthly profit amount must be greater than zero.');
  }

  const pool = await ensurePool();
  pool.balance = money(pool.balance + normalized);
  pool.entries.push({
    type: 'monthly_profit',
    direction: 'credit',
    amount: normalized,
    balanceAfter: pool.balance,
    note: note?.trim() || 'Monthly project profit / dividend',
    source: source?.trim() || '',
    createdBy,
    createdAt: new Date(),
  });
  await pool.save();

  let ledgerResult = null;
  let ledgerWarning = null;
  if (creditBankLedger) {
    try {
      ledgerResult = await creditInbound({
        type: 'monthly_profit',
        amount: normalized,
        referenceType: 'ProfitPool',
        referenceId: pool._id,
        note: note?.trim() || `Monthly project profit / return (${source || 'general'})`,
        createdBy,
      });
    } catch (error) {
      console.error('[logMonthlyProfit] bank ledger credit failed:', error.message);
      ledgerWarning = error.message;
    }
  }

  return {
    pool: {
      balance: money(pool.balance),
      entry: pool.entries[pool.entries.length - 1],
    },
    ledger: ledgerResult?.ledger || null,
    ledgerEntry: ledgerResult?.entry || null,
    bookBalance: ledgerResult?.ledger?.bookBalance ?? null,
    ledgerWarning,
  };
}

async function distributeEqually({
  amount = null,
  note = '',
  distributedBy = 'Cashier',
  debitBankLedger = true,
} = {}) {
  const pool = await ensurePool();
  const available = money(pool.balance);
  const toDistribute = amount === null || amount === undefined || amount === ''
    ? available
    : money(amount);

  if (!(toDistribute > 0)) {
    throw httpError('No profit pool balance available to distribute.');
  }
  if (toDistribute > available + 0.001) {
    throw httpError(`Cannot distribute $${toDistribute.toFixed(2)}; pool balance is $${available.toFixed(2)}.`);
  }

  const distributionResult = await distributeAmountToMembers({
    totalAmount: toDistribute,
    distributionType: 'equal',
    distributedBy,
  });

  const profitDistribution = await ProfitDistribution.create({
    totalAmount: toDistribute,
    distributionType: 'equal',
    memberCount: distributionResult.memberCount,
    shares: distributionResult.shares,
    notes: note?.trim() || 'Equal distribution from monthly profit pool',
    distributedBy: distributedBy?.trim() || 'Cashier',
  });

  pool.balance = money(pool.balance - toDistribute);
  pool.entries.push({
    type: 'distribution',
    direction: 'debit',
    amount: toDistribute,
    balanceAfter: pool.balance,
    referenceType: 'ProfitDistribution',
    referenceId: profitDistribution._id,
    note: note?.trim() || 'Equal distribution to active members',
    createdBy: distributedBy,
    createdAt: new Date(),
  });
  await pool.save();

  let ledgerResult = null;
  if (debitBankLedger) {
    try {
      ledgerResult = await ledgerDebit({
        type: 'profit_distribution',
        amount: toDistribute,
        referenceType: 'ProfitDistribution',
        referenceId: profitDistribution._id,
        note: note?.trim() || 'Profit pool distributed to members',
        createdBy: distributedBy,
      });
    } catch (error) {
      // Member profits already credited; surface ledger issue without rolling back distribution
      console.warn('[profitPool] bank ledger debit failed:', error.message);
    }
  }

  return {
    distribution: profitDistribution,
    updatedMembers: distributionResult.updatedMembers,
    poolBalance: money(pool.balance),
    ledger: ledgerResult?.ledger || null,
    reportUrl: `/api/admin/profit-pool/distributions/${profitDistribution._id}/report.pdf`,
  };
}

module.exports = {
  ensurePool,
  getPool,
  logMonthlyProfit,
  distributeEqually,
};
