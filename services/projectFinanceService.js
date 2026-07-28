const Investment = require('../models/Investment');
const InvestmentProfit = require('../models/InvestmentProfit');
const User = require('../models/User');
const { formatMoney } = require('./moneyFormat');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { getDistributionType } = require('./societyConfig');

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

function normalizeOwnership({
  societyOwnershipPct,
  investorOwnershipPct,
  amount,
  societyAmount,
  externalAmount,
} = {}) {
  const total = money(amount);
  if (!(total > 0)) {
    throw httpError('Project amount must be greater than zero.');
  }

  let societyPct = societyOwnershipPct;
  let investorPct = investorOwnershipPct;

  if (societyPct == null && investorPct == null && societyAmount == null && externalAmount == null) {
    societyPct = 100;
    investorPct = 0;
  }

  if (societyAmount != null || externalAmount != null) {
    const sAmt = money(societyAmount != null ? societyAmount : total - money(externalAmount));
    const eAmt = money(externalAmount != null ? externalAmount : total - sAmt);
    if (Math.abs(money(sAmt + eAmt) - total) > 0.02) {
      throw httpError('Society amount + external amount must equal total project amount.');
    }
    societyPct = total > 0 ? money((sAmt / total) * 100) : 100;
    investorPct = money(100 - societyPct);
    return {
      amount: total,
      societyOwnershipPct: societyPct,
      investorOwnershipPct: investorPct,
      societyAmount: sAmt,
      externalAmount: eAmt,
    };
  }

  societyPct = Number(societyPct);
  investorPct = Number(investorPct);
  if (!Number.isFinite(societyPct) || !Number.isFinite(investorPct)) {
    throw httpError('Ownership percentages are required.');
  }
  if (Math.abs(money(societyPct + investorPct) - 100) > 0.05) {
    throw httpError('Society and investor ownership percentages must add up to 100%.');
  }
  if (societyPct < 0 || investorPct < 0 || societyPct > 100 || investorPct > 100) {
    throw httpError('Ownership percentages must be between 0 and 100.');
  }

  const sAmt = money((total * societyPct) / 100);
  const eAmt = money(total - sAmt);
  return {
    amount: total,
    societyOwnershipPct: money(societyPct),
    investorOwnershipPct: money(investorPct),
    societyAmount: sAmt,
    externalAmount: eAmt,
  };
}

function splitByOwnership(totalAmount, societyPct, investorPct) {
  const total = money(totalAmount);
  const sPct = Number(societyPct) || 0;
  const societyShare = money((total * sPct) / 100);
  const investorShare = money(total - societyShare);
  return {
    total,
    societyShare,
    investorShare,
    societyOwnershipPct: money(sPct),
    investorOwnershipPct: money(Number(investorPct) || money(100 - sPct)),
  };
}

function assertNotLocked(investment) {
  if (investment.ledgerLockedAt || ['sold', 'closed'].includes(investment.status)) {
    throw httpError('This project ledger is locked after sale/settlement and cannot be modified.', 409);
  }
}

async function getActiveProject(investmentIdOrCode) {
  const query = String(investmentIdOrCode || '').match(/^[a-f\d]{24}$/i)
    ? { _id: investmentIdOrCode }
    : { investmentCode: String(investmentIdOrCode || '').trim().toUpperCase() };

  const investment = await Investment.findOne(query)
    .populate('investor', 'name email role phone')
    .populate('projectManager', 'name email role');
  if (!investment) {
    throw httpError('Project / investment not found.', 404);
  }
  return investment;
}

/**
 * Cashier records inbound external investor capital for a co-funded project.
 */
async function recordExternalInvestment({
  investmentId,
  amount = null,
  note = '',
  paymentChannel = '',
  paymentReference = '',
  recordedBy = 'Cashier',
} = {}) {
  const investment = await getActiveProject(investmentId);
  assertNotLocked(investment);

  if (!['active', 'pending_cashier_payment', 'pending_member_approval'].includes(investment.status)) {
    throw httpError('External capital can only be recorded for open projects.');
  }

  const expected = money(investment.externalAmount || 0);
  if (expected <= 0) {
    throw httpError('This project has 0% external ownership — no external capital to record.');
  }

  const received = money(amount != null ? amount : expected);
  if (!(received > 0)) {
    throw httpError('External investment amount must be greater than zero.');
  }
  if (Math.abs(received - expected) > 0.02) {
    throw httpError(
      `External capital must equal the project external share ${formatMoney(expected, 2)}. Received ${formatMoney(received, 2)}.`
    );
  }
  if (money(investment.externalCapitalReceived) > 0) {
    throw httpError('External capital has already been recorded for this project.', 409);
  }

  const { creditInbound } = require('./bankLedgerService');
  const bankLedger = await creditInbound({
    type: 'external_investment',
    amount: received,
    referenceType: 'Investment',
    referenceId: investment._id,
    note: note?.trim()
      || `External investor capital for ${investment.investmentCode} (${investment.investorName || 'investor'})`,
    createdBy: recordedBy,
    paymentChannel: paymentChannel || '',
    paymentReference: paymentReference || '',
  });

  investment.externalCapitalReceived = received;
  investment.externalCapitalReceivedAt = new Date();
  investment.externalCapitalRecordedBy = String(recordedBy || 'Cashier').trim();
  investment.externalCapitalLedgerEntryId = bankLedger?.entry?._id || null;
  await investment.save();

  await createAdminNotification({
    type: 'general',
    title: `External capital recorded: ${investment.investmentCode}`,
    message: `${formatMoney(received, 2)} received from ${investment.investorName || 'investor'} (${investment.investorOwnershipPct}% ownership).`,
    relatedId: investment._id,
    relatedModel: 'Investment',
  });

  return {
    investment,
    bankLedger,
    message: `External investment of ${formatMoney(received, 2)} recorded for ${investment.investmentCode}.`,
  };
}

async function distributeSocietyShareToMembers(societyShare, recordedBy, options = {}) {
  if (!(societyShare > 0)) {
    return { memberCount: 0, shares: [], updatedMembers: [], distributionType: 'balance' };
  }
  const { distributeAmountToMembers } = require('./profitService');
  const now = new Date();
  const yearMonth = options.yearMonth
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Running-project profits: include members eligible for this month, split by savings+profit balance ratio.
  return distributeAmountToMembers({
    totalAmount: societyShare,
    distributionType: 'balance',
    forceDistributionType: true,
    distributedBy: recordedBy,
    yearMonth,
    asOfDate: options.asOfDate || now,
  });
}

/**
 * Monthly return projects: record recurring profit and split by ownership.
 * New members activated mid-month become eligible starting next calendar month.
 */
async function recordMonthlyProjectReturn({
  investmentId,
  profitAmount,
  notes = '',
  recordedBy = 'Cashier',
  yearMonth = null,
} = {}) {
  const investment = await getActiveProject(investmentId);
  assertNotLocked(investment);

  if (investment.status !== 'active') {
    throw httpError('Monthly returns can only be recorded for active projects.');
  }
  if (investment.returnMode !== 'monthly') {
    throw httpError('This project is fixed/term — use sale/liquidation instead of monthly returns.');
  }

  const profit = money(profitAmount);
  if (!(profit > 0)) {
    throw httpError('Monthly profit amount must be greater than zero.');
  }

  const split = splitByOwnership(
    profit,
    investment.societyOwnershipPct,
    investment.investorOwnershipPct
  );

  const now = new Date();
  const periodYearMonth = yearMonth
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const distribution = await distributeSocietyShareToMembers(split.societyShare, recordedBy, {
    yearMonth: periodYearMonth,
    asOfDate: now,
  });

  investment.profit = money(Number(investment.profit || 0) + profit);
  investment.monthlyProfitTotal = money(Number(investment.monthlyProfitTotal || 0) + profit);
  investment.investorProfitBalance = money(
    Number(investment.investorProfitBalance || 0) + split.investorShare
  );
  await investment.save();

  const record = await InvestmentProfit.create({
    investment: investment._id,
    investmentCode: investment.investmentCode,
    sector: investment.sector,
    partner: investment.partner,
    investmentAmount: Number(investment.amount || 0),
    saleAmount: 0,
    profitAmount: profit,
    outcomeType: 'profit',
    distributionType: distribution.distributionType || 'balance',
    memberCount: distribution.memberCount,
    shares: distribution.shares,
    societyProfitShare: split.societyShare,
    investorProfitShare: split.investorShare,
    societyOwnershipPct: split.societyOwnershipPct,
    investorOwnershipPct: split.investorOwnershipPct,
    distributionKind: 'monthly_return',
    notes: notes?.trim() || `Monthly project return (${periodYearMonth}) — balance-ratio split; new members from next month after join`,
    recordedBy: String(recordedBy || 'Cashier').trim(),
  });

  let bankLedger = null;
  try {
    const { creditInbound } = require('./bankLedgerService');
    bankLedger = await creditInbound({
      type: 'monthly_profit',
      amount: profit,
      referenceType: 'InvestmentProfit',
      referenceId: record._id,
      note: `Monthly return ${investment.investmentCode} (${periodYearMonth})`,
      createdBy: recordedBy,
    });
  } catch (error) {
    console.warn('[recordMonthlyProjectReturn] ledger credit failed:', error.message);
  }

  return {
    investment,
    record,
    split,
    distribution,
    yearMonth: periodYearMonth,
    bankLedger,
    message: `Monthly return ${formatMoney(profit, 2)} for ${periodYearMonth} split — society ${formatMoney(split.societyShare, 2)} by balance ratio among ${distribution.memberCount} eligible member(s), investor ${formatMoney(split.investorShare, 2)}.`,
  };
}

/**
 * Sale / liquidation: split sale proceeds by ownership, settle capital + profit, lock ledger.
 */
async function liquidateProject({
  investmentId,
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  notes = '',
  recordedBy = 'Admin',
} = {}) {
  const investment = await getActiveProject(investmentId);
  assertNotLocked(investment);

  if (investment.status !== 'active') {
    throw httpError('Only active projects can be sold / liquidated.');
  }

  const grossSale = money(saleAmount);
  if (!(grossSale >= 0)) {
    throw httpError('Sale proceeds must be a non-negative amount.');
  }
  const costs = money(additionalCosts);
  const taxAmt = money(tax);
  const netProceeds = money(grossSale - costs - taxAmt);
  const capital = money(investment.amount || 0);
  const netProfit = money(netProceeds - capital);

  const capitalSplit = splitByOwnership(
    capital,
    investment.societyOwnershipPct,
    investment.investorOwnershipPct
  );
  const profitSplit = splitByOwnership(
    Math.max(netProfit, 0),
    investment.societyOwnershipPct,
    investment.investorOwnershipPct
  );
  const lossAmount = netProfit < 0 ? money(Math.abs(netProfit)) : 0;
  const lossSplit = splitByOwnership(
    lossAmount,
    investment.societyOwnershipPct,
    investment.investorOwnershipPct
  );

  // Credit full net proceeds into society bank first.
  let bankLedger = null;
  if (netProceeds > 0) {
    const { creditInbound } = require('./bankLedgerService');
    bankLedger = await creditInbound({
      type: 'project_sale',
      amount: netProceeds,
      referenceType: 'Investment',
      referenceId: investment._id,
      note: `Project sale/liquidation ${investment.investmentCode}`,
      createdBy: recordedBy,
    });
  }

  // Society capital return → member savings; society profit → member profit.
  const { refundToTotalSavings } = require('./investmentService');
  let savingsUpdate = null;
  if (capitalSplit.societyShare > 0 && netProceeds > 0) {
    const societyCapitalReturn = money(Math.min(capitalSplit.societyShare, Math.max(netProceeds, 0)));
    if (societyCapitalReturn > 0) {
      savingsUpdate = await refundToTotalSavings(societyCapitalReturn);
    }
  }

  let distribution = { memberCount: 0, shares: [], updatedMembers: [] };
  if (profitSplit.societyShare > 0) {
    distribution = await distributeSocietyShareToMembers(profitSplit.societyShare, recordedBy);
  }

  // Investor settlement from bank (capital share + profit share − loss share)
  const investorPayout = money(
    Math.max(0, capitalSplit.investorShare + profitSplit.investorShare - lossSplit.investorShare)
    + money(investment.investorProfitBalance || 0)
  );
  let investorLedger = null;
  if (investorPayout > 0) {
    try {
      const { tryDebit } = require('./bankLedgerService');
      investorLedger = await tryDebit({
        type: 'investor_payout',
        amount: investorPayout,
        referenceType: 'Investment',
        referenceId: investment._id,
        note: `Investor settlement ${investment.investmentCode} → ${investment.investorName || 'investor'}`,
        createdBy: recordedBy,
      });
    } catch (error) {
      console.warn('[liquidateProject] investor payout debit failed:', error.message);
    }
  }

  const record = await InvestmentProfit.create({
    investment: investment._id,
    investmentCode: investment.investmentCode,
    sector: investment.sector,
    partner: investment.partner,
    investmentAmount: capital,
    saleAmount: grossSale,
    profitAmount: Math.max(money(Math.abs(netProfit)), 0.01),
    outcomeType: netProfit >= 0 ? 'profit' : 'loss',
    distributionType: getDistributionType(),
    memberCount: distribution.memberCount,
    shares: distribution.shares,
    societyProfitShare: profitSplit.societyShare,
    investorProfitShare: profitSplit.investorShare,
    societyOwnershipPct: capitalSplit.societyOwnershipPct,
    investorOwnershipPct: capitalSplit.investorOwnershipPct,
    distributionKind: netProfit >= 0 ? 'sale' : 'loss',
    notes: notes?.trim()
      || `Liquidation net ${formatMoney(netProceeds, 2)} (sale ${formatMoney(grossSale, 2)} − costs ${formatMoney(costs, 2)} − tax ${formatMoney(taxAmt, 2)})`,
    recordedBy: String(recordedBy || 'Admin').trim(),
  });

  investment.saleAmount = grossSale;
  investment.outcomeType = netProfit >= 0 ? 'profit' : 'loss';
  investment.profit = money(Number(investment.profit || 0) + Math.max(netProfit, 0));
  investment.investorProfitBalance = 0;
  investment.status = 'closed';
  investment.soldAt = new Date();
  investment.closedAt = new Date();
  investment.ledgerLockedAt = new Date();
  investment.ledgerLockedBy = String(recordedBy || 'Admin').trim();
  investment.notes = [
    investment.notes || '',
    notes?.trim() || '',
    `Closed/sold. Society ${investment.societyOwnershipPct}% / Investor ${investment.investorOwnershipPct}%.`,
  ].filter(Boolean).join(' | ');
  if (bankLedger?.entry?._id) {
    investment.bankLedgerEntryId = bankLedger.entry._id;
  }
  await investment.save();

  await createAdminNotification({
    type: 'general',
    title: `Project closed: ${investment.investmentCode}`,
    message: `Sale settled. Net ${formatMoney(netProceeds, 2)}. Ledger locked.`,
    relatedId: investment._id,
    relatedModel: 'Investment',
  });

  if (investment.investor) {
    await createMemberNotification({
      memberId: investment.investor,
      type: 'general',
      title: `Project settled: ${investment.investmentCode}`,
      message: `Your ownership share was settled for ${formatMoney(investorPayout, 2)}.`,
      relatedId: investment._id,
      relatedModel: 'Investment',
    }).catch(() => {});
  }

  return {
    investment,
    record,
    settlement: {
      grossSale,
      additionalCosts: costs,
      tax: taxAmt,
      netProceeds,
      capital,
      netProfit,
      capitalSplit,
      profitSplit,
      lossSplit,
      investorPayout,
      societyCapitalReturn: capitalSplit.societyShare,
      societyProfitShare: profitSplit.societyShare,
    },
    savingsUpdate,
    distribution,
    bankLedger,
    investorLedger,
    message: `Project ${investment.investmentCode} sold/closed. Ledgers locked.`,
  };
}

async function listExternalCapitalQueue() {
  return Investment.find({
    status: { $in: ['active', 'pending_cashier_payment', 'pending_member_approval'] },
    externalAmount: { $gt: 0 },
    externalCapitalReceived: { $lte: 0 },
    ledgerLockedAt: null,
  })
    .populate('investor', 'name email phone')
    .sort({ createdAt: -1 })
    .lean();
}

async function listActiveMonthlyProjects() {
  return Investment.find({
    status: 'active',
    returnMode: 'monthly',
    ledgerLockedAt: null,
  })
    .populate('investor', 'name email')
    .sort({ updatedAt: -1 })
    .lean();
}

module.exports = {
  money,
  normalizeOwnership,
  splitByOwnership,
  assertNotLocked,
  getActiveProject,
  recordExternalInvestment,
  recordMonthlyProjectReturn,
  liquidateProject,
  listExternalCapitalQueue,
  listActiveMonthlyProjects,
};
