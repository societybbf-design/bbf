const Deposit = require('../models/Deposit');
const BankLedgerEntry = require('../models/BankLedgerEntry');
const ProfitDistribution = require('../models/ProfitDistribution');
const { ensurePool } = require('./profitPoolService');
const { PAYMENT_CHANNELS } = require('./paymentChannelService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthSeries(monthCount = 12, now = new Date()) {
  const labels = [];
  const keys = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let index = monthCount - 1; index >= 0; index -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    keys.push(monthKey(date));
    labels.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
  }
  return { labels, keys };
}

async function getFinancialTrends({ months = 12 } = {}) {
  const now = new Date();
  const { labels, keys } = buildMonthSeries(months, now);
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const [deposits, ledgerCredits, ledgerDebits, distributions, pool] = await Promise.all([
    Deposit.find({ createdAt: { $gte: start } }).select('amount createdAt paymentMethod').lean(),
    BankLedgerEntry.find({ direction: 'credit', createdAt: { $gte: start } }).select('amount type createdAt paymentChannel').lean(),
    BankLedgerEntry.find({ direction: 'debit', createdAt: { $gte: start } }).select('amount type createdAt paymentChannel').lean(),
    ProfitDistribution.find({ createdAt: { $gte: start } }).select('totalAmount createdAt').lean(),
    ensurePool(),
  ]);

  const depositSeries = keys.map(() => 0);
  const revenueSeries = keys.map(() => 0);
  const payoutSeries = keys.map(() => 0);
  const profitSeries = keys.map(() => 0);

  deposits.forEach((deposit) => {
    const key = monthKey(new Date(deposit.createdAt));
    const index = keys.indexOf(key);
    if (index >= 0) depositSeries[index] = money(depositSeries[index] + Number(deposit.amount || 0));
  });

  ledgerCredits.forEach((entry) => {
    const key = monthKey(new Date(entry.createdAt));
    const index = keys.indexOf(key);
    if (index >= 0) revenueSeries[index] = money(revenueSeries[index] + Number(entry.amount || 0));
  });

  ledgerDebits.forEach((entry) => {
    const key = monthKey(new Date(entry.createdAt));
    const index = keys.indexOf(key);
    if (index >= 0) payoutSeries[index] = money(payoutSeries[index] + Number(entry.amount || 0));
  });

  distributions.forEach((distribution) => {
    const key = monthKey(new Date(distribution.createdAt));
    const index = keys.indexOf(key);
    if (index >= 0) profitSeries[index] = money(profitSeries[index] + Number(distribution.totalAmount || 0));
  });

  const channelTotals = PAYMENT_CHANNELS.reduce((acc, channel) => {
    acc[channel.key] = { label: channel.label, in: 0, out: 0 };
    return acc;
  }, {});

  ledgerCredits.forEach((entry) => {
    const key = entry.paymentChannel || 'cash';
    if (!channelTotals[key]) channelTotals[key] = { label: key, in: 0, out: 0 };
    channelTotals[key].in = money(channelTotals[key].in + Number(entry.amount || 0));
  });
  ledgerDebits.forEach((entry) => {
    const key = entry.paymentChannel || 'cash';
    if (!channelTotals[key]) channelTotals[key] = { label: key, in: 0, out: 0 };
    channelTotals[key].out = money(channelTotals[key].out + Number(entry.amount || 0));
  });

  return {
    labels,
    series: {
      deposits: depositSeries,
      revenueIn: revenueSeries,
      payoutsOut: payoutSeries,
      profitDistributions: profitSeries,
    },
    totals: {
      deposits: money(depositSeries.reduce((sum, value) => sum + value, 0)),
      revenueIn: money(revenueSeries.reduce((sum, value) => sum + value, 0)),
      payoutsOut: money(payoutSeries.reduce((sum, value) => sum + value, 0)),
      profitDistributions: money(profitSeries.reduce((sum, value) => sum + value, 0)),
      profitPoolBalance: money(pool.balance),
    },
    paymentChannels: Object.entries(channelTotals).map(([key, value]) => ({
      key,
      label: value.label,
      totalIn: value.in,
      totalOut: value.out,
      net: money(value.in - value.out),
    })),
  };
}

async function getMemberFinancialTrends(memberId, { months = 12 } = {}) {
  const now = new Date();
  const { labels, keys } = buildMonthSeries(months, now);
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const deposits = await Deposit.find({ member: memberId, createdAt: { $gte: start } })
    .select('amount createdAt')
    .lean();

  const depositSeries = keys.map(() => 0);
  deposits.forEach((deposit) => {
    const key = monthKey(new Date(deposit.createdAt));
    const index = keys.indexOf(key);
    if (index >= 0) depositSeries[index] = money(depositSeries[index] + Number(deposit.amount || 0));
  });

  return {
    labels,
    series: {
      deposits: depositSeries,
    },
    totals: {
      deposits: money(depositSeries.reduce((sum, value) => sum + value, 0)),
    },
  };
}

module.exports = {
  getFinancialTrends,
  getMemberFinancialTrends,
};
