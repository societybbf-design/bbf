'use strict';

const ExternalInvestorWallet = require('../models/ExternalInvestorWallet');
const ExternalInvestorWalletEntry = require('../models/ExternalInvestorWalletEntry');
const User = require('../models/User');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureWallet(investorId, { investorName = '' } = {}) {
  if (!investorId) throw httpError('External investor is required.');
  let wallet = await ExternalInvestorWallet.findOne({ investor: investorId });
  if (wallet) {
    if (investorName && !wallet.investorName) {
      wallet.investorName = String(investorName).trim();
      await wallet.save();
    }
    return wallet;
  }

  const user = await User.findOne({
    _id: investorId,
    role: 'external_investor',
    status: { $ne: 'deleted' },
  }).select('name email');
  if (!user) throw httpError('External investor not found.', 404);

  wallet = await ExternalInvestorWallet.create({
    investor: user._id,
    investorName: investorName || user.name || '',
    availableBalance: 0,
    reservedBalance: 0,
    lockedBalance: 0,
    totalDeposited: 0,
  });
  return wallet;
}

async function recordWalletEntry(wallet, {
  type,
  amount,
  investment = null,
  investmentCode = '',
  note = '',
  createdBy = '',
} = {}) {
  return ExternalInvestorWalletEntry.create({
    wallet: wallet._id,
    investor: wallet.investor,
    type,
    amount: money(amount),
    availableAfter: money(wallet.availableBalance),
    reservedAfter: money(wallet.reservedBalance),
    lockedAfter: money(wallet.lockedBalance),
    investment: investment || null,
    investmentCode: String(investmentCode || '').trim(),
    note: String(note || '').trim(),
    createdBy: String(createdBy || '').trim(),
  });
}

async function getWalletSnapshot(investorId) {
  const wallet = await ensureWallet(investorId);
  return {
    investorId: String(wallet.investor),
    investorName: wallet.investorName || '',
    availableBalance: money(wallet.availableBalance),
    reservedBalance: money(wallet.reservedBalance),
    lockedBalance: money(wallet.lockedBalance),
    totalDeposited: money(wallet.totalDeposited),
    totalBalance: money(
      Number(wallet.availableBalance || 0)
      + Number(wallet.reservedBalance || 0)
      + Number(wallet.lockedBalance || 0)
    ),
  };
}

/**
 * CEO records physical cash into the investor's unallocated wallet.
 */
async function creditWalletDeposit({
  investorId,
  amount,
  note = '',
  recordedBy = 'CEO',
} = {}) {
  const deposit = money(amount);
  if (!(deposit > 0)) throw httpError('Deposit amount must be greater than zero.');

  const user = await User.findOne({
    _id: investorId,
    role: 'external_investor',
    status: { $ne: 'deleted' },
  }).select('name email');
  if (!user) throw httpError('External investor not found.', 404);

  const wallet = await ensureWallet(investorId, { investorName: user.name || '' });
  wallet.availableBalance = money(Number(wallet.availableBalance || 0) + deposit);
  wallet.totalDeposited = money(Number(wallet.totalDeposited || 0) + deposit);
  wallet.investorName = wallet.investorName || user.name || '';
  await wallet.save();

  const entry = await recordWalletEntry(wallet, {
    type: 'deposit',
    amount: deposit,
    note: note || `CEO cash deposit for ${user.name || 'External Investor'}`,
    createdBy: recordedBy,
  });

  return {
    wallet: await getWalletSnapshot(investorId),
    entry,
    deposit,
    message: `Recorded wallet deposit ${deposit.toFixed(2)} for ${user.name || 'External Investor'}. `
      + `Available balance ${money(wallet.availableBalance).toFixed(2)}.`,
  };
}

/**
 * Soft-hold capital for a pending project commitment (create-time).
 */
async function reserveForProject({
  investorId,
  amount,
  investment,
  note = '',
  createdBy = 'System',
} = {}) {
  const need = money(amount);
  if (!(need > 0)) throw httpError('Reserve amount must be greater than zero.');

  const wallet = await ensureWallet(investorId);
  const available = money(wallet.availableBalance);
  if (available + 0.001 < need) {
    throw httpError(
      `Insufficient External Investor wallet balance. `
      + `Need ${need.toFixed(2)}, available ${available.toFixed(2)}. `
      + 'Record a cash deposit on their profile before creating this project.',
      409
    );
  }

  wallet.availableBalance = money(available - need);
  wallet.reservedBalance = money(Number(wallet.reservedBalance || 0) + need);
  await wallet.save();

  await recordWalletEntry(wallet, {
    type: 'reserve',
    amount: need,
    investment: investment?._id || investment || null,
    investmentCode: investment?.investmentCode || '',
    note: note || `Reserved for project ${investment?.investmentCode || ''}`.trim(),
    createdBy,
  });

  return getWalletSnapshot(investorId);
}

async function unreserveForProject({
  investorId,
  amount,
  investment,
  note = '',
  createdBy = 'System',
} = {}) {
  const value = money(amount);
  if (!(value > 0)) return getWalletSnapshot(investorId);

  const wallet = await ensureWallet(investorId);
  const reserved = money(wallet.reservedBalance);
  const release = money(Math.min(reserved, value));
  wallet.reservedBalance = money(reserved - release);
  wallet.availableBalance = money(Number(wallet.availableBalance || 0) + release);
  await wallet.save();

  await recordWalletEntry(wallet, {
    type: 'unreserve',
    amount: release,
    investment: investment?._id || investment || null,
    investmentCode: investment?.investmentCode || '',
    note: note || `Released reserve for ${investment?.investmentCode || 'project'}`,
    createdBy,
  });

  return getWalletSnapshot(investorId);
}

/**
 * Finalize reserve → locked, after External Investor approval + CEO confirmation.
 */
async function lockReservedForProject({
  investorId,
  amount,
  investment,
  note = '',
  createdBy = 'CEO',
} = {}) {
  const need = money(amount);
  if (!(need > 0)) throw httpError('Lock amount must be greater than zero.');

  const wallet = await ensureWallet(investorId);
  const reserved = money(wallet.reservedBalance);
  if (reserved + 0.001 < need) {
    throw httpError(
      `Cannot lock ${need.toFixed(2)} — reserved balance is only ${reserved.toFixed(2)}.`,
      409
    );
  }

  wallet.reservedBalance = money(reserved - need);
  wallet.lockedBalance = money(Number(wallet.lockedBalance || 0) + need);
  await wallet.save();

  await recordWalletEntry(wallet, {
    type: 'lock',
    amount: need,
    investment: investment?._id || investment || null,
    investmentCode: investment?.investmentCode || '',
    note: note || `Locked capital for ${investment?.investmentCode || 'project'}`,
    createdBy,
  });

  return getWalletSnapshot(investorId);
}

/**
 * Assert every external stake can be covered by current available wallet balance.
 * Does not mutate wallets (reservation happens after investment is created).
 */
async function assertInvestorsCanCoverStakes(stakes = []) {
  const requiredByInvestor = new Map();
  for (const stake of stakes) {
    const id = String(stake.investor || stake.investorId || '');
    if (!id) continue;
    const amount = money(stake.amount);
    if (!(amount > 0)) continue;
    requiredByInvestor.set(id, money((requiredByInvestor.get(id) || 0) + amount));
  }

  const shortages = [];
  for (const [investorId, required] of requiredByInvestor.entries()) {
    const snap = await getWalletSnapshot(investorId);
    if (snap.availableBalance + 0.001 < required) {
      shortages.push({
        investorId,
        investorName: snap.investorName,
        required,
        available: snap.availableBalance,
      });
    }
  }

  if (shortages.length) {
    const detail = shortages
      .map((row) => `${row.investorName || row.investorId}: need ${row.required.toFixed(2)}, available ${row.available.toFixed(2)}`)
      .join('; ');
    throw httpError(
      `External Investor wallet balance is insufficient for this project. ${detail}. `
      + 'Record cash deposits on the External Investor profile before creating the project.',
      409
    );
  }

  return true;
}

module.exports = {
  money,
  ensureWallet,
  getWalletSnapshot,
  creditWalletDeposit,
  reserveForProject,
  unreserveForProject,
  lockReservedForProject,
  assertInvestorsCanCoverStakes,
};
