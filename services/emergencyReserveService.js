'use strict';

const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const EmergencyReserveFund = require('../models/EmergencyReserveFund');
const InvestmentContribution = require('../models/InvestmentContribution');
const { getLedger, debit: ledgerDebit, money } = require('./bankLedgerService');
const { calculateMemberShares } = require('./profitService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureFund() {
  let fund = await EmergencyReserveFund.findOne({ key: EmergencyReserveFund.FUND_KEY });
  if (!fund) {
    fund = await EmergencyReserveFund.create({
      key: EmergencyReserveFund.FUND_KEY,
      balance: 0,
      entries: [],
    });
  }
  return fund;
}

async function getActiveMembers() {
  return User.find({ role: 'member', status: 'active' }).sort({ name: 1 });
}

/**
 * Live proportional ownership of the reserve pool by savings + profit weight.
 */
async function listMemberReserveShares(poolBalance = null) {
  const fund = await ensureFund();
  const balance = poolBalance == null ? money(fund.balance) : money(poolBalance);
  const members = await getActiveMembers();
  if (!members.length) {
    return {
      balance,
      memberCount: 0,
      shares: [],
    };
  }

  if (!(balance > 0)) {
    return {
      balance: 0,
      memberCount: members.length,
      shares: members.map((member) => ({
        memberId: member._id,
        name: member.name,
        email: member.email,
        shareAmount: 0,
        weight: Number(member.savings || 0) + Number(member.profit || 0),
      })),
    };
  }

  const plan = calculateMemberShares(members, balance, 'proportional');
  return {
    balance,
    memberCount: members.length,
    shares: plan.map((row) => ({
      memberId: row.member._id,
      name: row.member.name,
      email: row.member.email,
      shareAmount: money(row.amount),
      weight: money(row.weight),
    })),
  };
}

async function getMemberReserveShare(memberId) {
  const overview = await listMemberReserveShares();
  const mine = overview.shares.find((row) => String(row.memberId) === String(memberId));
  return {
    fundBalance: overview.balance,
    memberCount: overview.memberCount,
    shareAmount: mine ? mine.shareAmount : 0,
    share: mine || null,
  };
}

async function getFund({ entryLimit = 40, includeShares = true } = {}) {
  const fund = await ensureFund();
  const ledger = await getLedger({ entryLimit: 1 }).catch(() => null);
  const entries = [...(fund.entries || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Math.min(Number(entryLimit) || 40, 100));

  const payload = {
    balance: money(fund.balance),
    bookBalance: ledger?.bookBalance ?? null,
    openingSet: ledger?.openingSet ?? false,
    entries,
    updatedAt: fund.updatedAt,
  };

  if (includeShares) {
    const shares = await listMemberReserveShares(fund.balance);
    payload.memberShares = shares.shares;
    payload.memberCount = shares.memberCount;
  }

  return payload;
}

async function pushEntry(fund, {
  type,
  direction,
  amount,
  note = '',
  createdBy = 'Cashier',
  referenceType = '',
  referenceId = null,
}) {
  const normalized = money(amount);
  if (direction === 'credit') {
    fund.balance = money(Number(fund.balance || 0) + normalized);
  } else {
    if (normalized > money(fund.balance) + 0.001) {
      throw httpError(
        `Emergency reserve has only ${formatMoney(money(fund.balance), 2)} available.`
      );
    }
    fund.balance = money(Math.max(0, Number(fund.balance || 0) - normalized));
  }

  fund.entries.push({
    type,
    direction,
    amount: normalized,
    balanceAfter: fund.balance,
    note: note?.trim() || '',
    createdBy,
    referenceType,
    referenceId,
    createdAt: new Date(),
  });
  await fund.save();
  return fund.entries[fund.entries.length - 1];
}

/**
 * Move cash from society book balance into the Emergency / Reserve Fund.
 */
async function allocateFromBookBalance(amount, {
  note = '',
  createdBy = 'Cashier',
} = {}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('Allocation amount must be greater than zero.');
  }

  const ledger = await getLedger({ entryLimit: 1 });
  if (!ledger.openingSet) {
    throw httpError('Set the bank ledger opening balance before allocating to the reserve fund.');
  }
  if (normalized > money(ledger.bookBalance) + 0.001) {
    throw httpError(
      `Insufficient book balance. Available: ${formatMoney(money(ledger.bookBalance), 2)}.`
    );
  }

  const fund = await ensureFund();
  const ledgerResult = await ledgerDebit({
    type: 'reserve_allocation',
    amount: normalized,
    referenceType: 'EmergencyReserveFund',
    referenceId: fund._id,
    note: note?.trim() || `Allocated to Emergency / Reserve Fund`,
    createdBy,
  });

  const entry = await pushEntry(fund, {
    type: 'allocation',
    direction: 'credit',
    amount: normalized,
    note: note?.trim() || 'Allocated from society book balance',
    createdBy,
    referenceType: 'BankLedger',
    referenceId: ledgerResult?.entry?._id || null,
  });

  const shares = await listMemberReserveShares(fund.balance);

  return {
    fund: {
      balance: money(fund.balance),
      entry,
    },
    ledger: ledgerResult?.ledger || null,
    bookBalance: ledgerResult?.ledger?.bookBalance ?? null,
    memberShares: shares.shares,
    message: `Allocated ${formatMoney(normalized, 2)} from book balance to Emergency / Reserve Fund.`,
  };
}

async function assertReserveBalance(amount) {
  const fund = await ensureFund();
  const normalized = money(amount);
  if (normalized > money(fund.balance) + 0.001) {
    throw httpError(
      `Emergency reserve has only ${formatMoney(money(fund.balance), 2)} available.`
    );
  }
  return fund;
}

/**
 * Debit the reserve pool (cash already earmarked from book when allocated).
 */
async function debitReserve(amount, {
  type = 'adjustment',
  note = '',
  createdBy = 'Cashier',
  referenceType = '',
  referenceId = null,
} = {}) {
  const fund = await assertReserveBalance(amount);
  const entry = await pushEntry(fund, {
    type,
    direction: 'debit',
    amount,
    note,
    createdBy,
    referenceType,
    referenceId,
  });
  return {
    fund,
    entry,
    balance: money(fund.balance),
  };
}

/**
 * Cover an unpaid project contribution from the Emergency / Reserve Fund.
 */
async function coverContributionFromReserve(contributionId, {
  amount = null,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  const contribution = await InvestmentContribution.findById(contributionId)
    .populate('member', 'name email')
    .populate('investment', 'investmentCode amount status');
  if (!contribution) {
    throw httpError('Contribution not found.', 404);
  }

  const due = money(contribution.unpaidAmount);
  if (!(due > 0)) {
    throw httpError('This contribution has no unpaid balance to cover.');
  }

  const payAmount = amount == null || amount === '' ? due : money(amount);
  if (!(payAmount > 0)) {
    throw httpError('Cover amount must be greater than zero.');
  }
  if (payAmount > due + 0.001) {
    throw httpError(`Cover amount exceeds unpaid due of ${formatMoney(due, 2)}.`);
  }

  const result = await debitReserve(payAmount, {
    type: 'project_cover',
    note: note?.trim()
      || `Cover unpaid share for ${contribution.memberName || contribution.member?.name || 'member'} · ${contribution.investment?.investmentCode || 'project'}`,
    createdBy,
    referenceType: 'InvestmentContribution',
    referenceId: contribution._id,
  });

  contribution.unpaidAmount = money(Math.max(0, due - payAmount));
  contribution.paidFromAdvance = money(Number(contribution.paidFromAdvance || 0) + payAmount);
  contribution.status = contribution.unpaidAmount > 0.001 ? 'unpaid' : 'paid';
  await contribution.save();

  return {
    contribution,
    reserve: {
      balance: result.balance,
      entry: result.entry,
    },
    coveredAmount: payAmount,
    remainingUnpaid: money(contribution.unpaidAmount),
  };
}

module.exports = {
  money,
  ensureFund,
  getFund,
  listMemberReserveShares,
  getMemberReserveShare,
  allocateFromBookBalance,
  debitReserve,
  assertReserveBalance,
  coverContributionFromReserve,
};
