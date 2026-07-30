const Investment = require('../models/Investment');
const InvestmentProfit = require('../models/InvestmentProfit');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { formatMoney } = require('./moneyFormat');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { getDistributionType } = require('./societyConfig');
const {
  withMongoTransaction,
  bindSession,
  sessionOpt,
  createWithSession,
} = require('./mongoTransaction');

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

async function getActiveProject(investmentIdOrCode, session = null) {
  const query = String(investmentIdOrCode || '').match(/^[a-f\d]{24}$/i)
    ? { _id: investmentIdOrCode }
    : { investmentCode: String(investmentIdOrCode || '').trim().toUpperCase() };

  const investment = await bindSession(
    Investment.findOne(query)
      .populate('investor', 'name email role phone')
      .populate('projectManager', 'name email role'),
    session
  );
  if (!investment) {
    throw httpError('Project / investment not found.', 404);
  }
  return investment;
}

/** Active sibling investments for the same property/sector (Sell Project group capital). */
async function listRelatedActiveInvestments(primary, session = null) {
  const location = String(primary.location || '').trim();
  const sector = String(primary.sector || '').trim();
  let filter;
  if (location) {
    filter = { location, status: 'active', ledgerLockedAt: null };
  } else if (sector) {
    filter = { sector, status: 'active', ledgerLockedAt: null };
  } else {
    filter = { _id: primary._id, status: 'active', ledgerLockedAt: null };
  }
  const rows = await bindSession(
    Investment.find(filter).sort({ createdAt: 1 }),
    session
  );
  if (!rows.some((row) => String(row._id) === String(primary._id))) {
    return [primary, ...rows];
  }
  return rows;
}

async function nextSaleCode(session = null) {
  const year = new Date().getFullYear();
  const prefix = `SALE-${year}-`;
  const latest = await bindSession(
    Sale.findOne({ saleCode: { $regex: `^${prefix}` } }).sort({ saleCode: -1 }).select('saleCode'),
    session
  );
  let seq = 1;
  if (latest?.saleCode) {
    const part = Number(String(latest.saleCode).split('-').pop());
    if (Number.isFinite(part)) seq = part + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
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
    targetRoles: ['ceo', 'cashier'],
  });

  return {
    investment,
    bankLedger,
    message: `External investment of ${formatMoney(received, 2)} recorded for ${investment.investmentCode}.`,
  };
}

async function distributeSocietyShareToMembers(societyShare, recordedBy, options = {}) {
  if (!(societyShare > 0)) {
    return { memberCount: 0, shares: [], updatedMembers: [], distributionType: 'equal' };
  }
  const { distributeAmountToMembers } = require('./profitService');
  const { getDistributionType } = require('./societyConfig');
  const now = new Date();
  const yearMonth = options.yearMonth
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Equal-share society: every eligible active member gets the same profit.
  // Late payment / internal borrow / emergency cover do not change eligibility or share size.
  return distributeAmountToMembers({
    totalAmount: societyShare,
    distributionType: getDistributionType(),
    forceDistributionType: false,
    distributedBy: recordedBy,
    yearMonth,
    asOfDate: options.asOfDate || now,
    session: options.session || null,
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
  const result = await withMongoTransaction(async (session) => {
    const investment = await getActiveProject(investmentId, session);
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
      session,
    });

    investment.profit = money(Number(investment.profit || 0) + profit);
    investment.monthlyProfitTotal = money(Number(investment.monthlyProfitTotal || 0) + profit);
    investment.investorProfitBalance = money(
      Number(investment.investorProfitBalance || 0) + split.investorShare
    );
    await investment.save(sessionOpt(session));

    const record = await createWithSession(InvestmentProfit, {
      investment: investment._id,
      investmentCode: investment.investmentCode,
      sector: investment.sector,
      partner: investment.partner,
      investmentAmount: Number(investment.amount || 0),
      saleAmount: 0,
      profitAmount: profit,
      outcomeType: 'profit',
      distributionType: distribution.distributionType || getDistributionType(),
      memberCount: distribution.memberCount,
      shares: distribution.shares,
      societyProfitShare: split.societyShare,
      investorProfitShare: split.investorShare,
      societyOwnershipPct: split.societyOwnershipPct,
      investorOwnershipPct: split.investorOwnershipPct,
      distributionKind: 'monthly_return',
      notes: notes?.trim() || `Monthly project return (${periodYearMonth}) — equal share among eligible members; new members from next month after join`,
      recordedBy: String(recordedBy || 'Cashier').trim(),
    }, session);

    const { creditInbound } = require('./bankLedgerService');
    const bankLedger = await creditInbound({
      type: 'monthly_profit',
      amount: profit,
      referenceType: 'InvestmentProfit',
      referenceId: record._id,
      note: `Monthly return ${investment.investmentCode} (${periodYearMonth})`,
      createdBy: recordedBy,
      session,
    });

    return {
      investment,
      record,
      split,
      distribution,
      yearMonth: periodYearMonth,
      bankLedger,
      message: `Monthly return ${formatMoney(profit, 2)} for ${periodYearMonth} split — society ${formatMoney(split.societyShare, 2)} equally among ${distribution.memberCount} eligible member(s), investor ${formatMoney(split.investorShare, 2)}.`,
    };
  });

  return result;
}

/**
 * Pure cent-safe settlement math for Sell Project / liquidation.
 * Cash identity: societySavingsRefund + investorSaleSettlement + societyProfitShare = netProceeds
 * (society profit is booked to member profit balances; loss reduces society savings refund and member profit).
 */
function computeProjectLiquidationSettlement({
  capital,
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  societyOwnershipPct = 100,
  investorOwnershipPct = 0,
  accruedInvestorProfit = 0,
} = {}) {
  const groupCapital = money(capital);
  if (!(groupCapital > 0)) {
    throw httpError('Active project capital must be greater than zero.');
  }
  const grossSale = money(saleAmount);
  if (!(grossSale >= 0)) {
    throw httpError('Sale proceeds must be a non-negative amount.');
  }
  const costs = money(additionalCosts);
  const taxAmt = money(tax);
  if (costs < 0 || taxAmt < 0) {
    throw httpError('Additional costs and tax cannot be negative.');
  }

  const netProceeds = money(grossSale - costs - taxAmt);
  const netProfit = money(netProceeds - groupCapital);
  const outcomeType = netProfit > 0.001 ? 'profit' : (netProfit < -0.001 ? 'loss' : 'break_even');

  const capitalSplit = splitByOwnership(groupCapital, societyOwnershipPct, investorOwnershipPct);
  const profitSplit = splitByOwnership(
    Math.max(netProfit, 0),
    societyOwnershipPct,
    investorOwnershipPct
  );
  const lossAmount = outcomeType === 'loss' ? money(Math.abs(netProfit)) : 0;
  const lossSplit = splitByOwnership(lossAmount, societyOwnershipPct, investorOwnershipPct);

  // On loss, return only ownership share of net proceeds to savings (not full capital).
  // On profit/break-even, return full society capital; profit share is distributed separately.
  const societySavingsRefund = outcomeType === 'loss'
    ? money(Math.max(0, capitalSplit.societyShare - lossSplit.societyShare))
    : capitalSplit.societyShare;
  const investorSaleSettlement = money(Math.max(
    0,
    capitalSplit.investorShare + profitSplit.investorShare - lossSplit.investorShare
  ));
  const accrued = money(Math.max(0, accruedInvestorProfit));
  const investorPayout = money(investorSaleSettlement + accrued);

  // Sale-cash identity (excludes previously accrued investor profit already in the bank).
  const allocatedFromSale = money(
    societySavingsRefund + investorSaleSettlement + profitSplit.societyShare
  );
  if (Math.abs(allocatedFromSale - Math.max(netProceeds, 0)) > 0.02 && netProceeds >= 0) {
    throw httpError('Settlement math failed cash conservation check. Refresh and retry.', 500);
  }

  return {
    capital: groupCapital,
    grossSale,
    additionalCosts: costs,
    tax: taxAmt,
    netProceeds,
    netProfit,
    outcomeType,
    capitalSplit,
    profitSplit,
    lossSplit,
    societySavingsRefund,
    societyProfitShare: profitSplit.societyShare,
    societyLossShare: lossSplit.societyShare,
    investorSaleSettlement,
    accruedInvestorProfit: accrued,
    investorPayout,
  };
}

/**
 * Sale / liquidation: settle group capital with cent-safe math, update ledger/P&L,
 * create Sale row for Sell List, lock all related active investments atomically.
 */
async function liquidateProject({
  investmentId,
  saleAmount,
  additionalCosts = 0,
  tax = 0,
  notes = '',
  recordedBy = 'Admin',
  productName = '',
} = {}) {
  const result = await withMongoTransaction(async (session) => {
    const seed = await getActiveProject(investmentId, session);
    assertNotLocked(seed);
    if (seed.status !== 'active') {
      throw httpError('Only active projects can be sold / liquidated.');
    }

    const related = await listRelatedActiveInvestments(seed, session);
    const relatedIds = related.map((row) => row._id);
    const lockAt = new Date();
    // Atomic ledger lock on every related active row — blocks concurrent double-sell.
    const claimedCount = await Investment.updateMany(
      {
        _id: { $in: relatedIds },
        status: 'active',
        $or: [{ ledgerLockedAt: null }, { ledgerLockedAt: { $exists: false } }],
      },
      {
        $set: {
          ledgerLockedAt: lockAt,
          ledgerLockedBy: String(recordedBy || 'Admin').trim(),
          updatedAt: lockAt,
        },
      },
      sessionOpt(session)
    );
    const matched = claimedCount.matchedCount ?? claimedCount.n ?? 0;
    if (matched < relatedIds.length) {
      throw httpError('Project was already sold or locked. Refresh and try again.', 409);
    }

    const investment = await bindSession(
      Investment.findById(seed._id)
        .populate('investor', 'name email role phone')
        .populate('projectManager', 'name email role'),
      session
    );
    if (!investment) {
      throw httpError('Project / investment not found.', 404);
    }

    const capital = money(related.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const accruedInvestorProfit = money(
      related.reduce((sum, row) => sum + Number(row.investorProfitBalance || 0), 0)
    );
    const settlementPlan = computeProjectLiquidationSettlement({
      capital,
      saleAmount,
      additionalCosts,
      tax,
      societyOwnershipPct: investment.societyOwnershipPct,
      investorOwnershipPct: investment.investorOwnershipPct,
      accruedInvestorProfit,
    });
    const {
      grossSale,
      additionalCosts: costs,
      tax: taxAmt,
      netProceeds,
      netProfit,
      outcomeType,
      capitalSplit,
      profitSplit,
      lossSplit,
      societySavingsRefund,
      investorPayout,
    } = settlementPlan;

    // Credit net proceeds into society bank (hard fail).
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
        session,
      });
    }

    const { refundToTotalSavings } = require('./investmentService');
    let savingsUpdate = null;
    if (societySavingsRefund > 0.001) {
      savingsUpdate = await refundToTotalSavings(societySavingsRefund, { session });
    }

    let distribution = { memberCount: 0, shares: [], updatedMembers: [], distributionType: getDistributionType() };
    if (profitSplit.societyShare > 0.001) {
      distribution = await distributeSocietyShareToMembers(profitSplit.societyShare, recordedBy, { session });
    } else if (lossSplit.societyShare > 0.001) {
      const { applyLossToMembers } = require('./profitService');
      distribution = await applyLossToMembers({
        totalLoss: lossSplit.societyShare,
        distributedBy: recordedBy,
        session,
      });
    }

    let investorLedger = null;
    if (investorPayout > 0.001) {
      const { debit } = require('./bankLedgerService');
      investorLedger = await debit({
        type: 'investor_payout',
        amount: investorPayout,
        referenceType: 'Investment',
        referenceId: investment._id,
        note: `Investor settlement ${investment.investmentCode} → ${investment.investorName || 'investor'}`,
        createdBy: recordedBy,
        session,
      });
    }

    const saleCode = await nextSaleCode(session);
    const projectLabel = [
      String(investment.location || '').trim(),
      String(investment.sector || '').trim(),
    ].filter(Boolean).join(' · ') || investment.investmentCode || 'Project';

    const sale = await createWithSession(Sale, {
      saleCode,
      productName: String(productName || '').trim() || projectLabel,
      projectLabel,
      primaryInvestment: investment._id,
      investmentCode: investment.investmentCode,
      investorName: investment.investorName || investment.partner || '',
      location: investment.location || '',
      sector: investment.sector || '',
      saleAmount: grossSale,
      additionalCosts: costs,
      tax: taxAmt,
      totalInvestment: capital,
      investmentLines: related.map((row) => ({
        investment: row._id,
        investmentCode: row.investmentCode || String(row._id),
        amount: money(row.amount),
      })),
      netProfitLoss: netProfit,
      outcomeType,
      notes: notes?.trim() || `Liquidation via ${investment.investmentCode}`,
      recordedBy: String(recordedBy || 'Admin').trim(),
    }, session);

    const record = await createWithSession(InvestmentProfit, {
      investment: investment._id,
      investmentCode: investment.investmentCode,
      sector: investment.sector,
      partner: investment.partner,
      investmentAmount: capital,
      saleAmount: grossSale,
      profitAmount: money(Math.abs(netProfit)),
      outcomeType,
      distributionType: distribution.distributionType || getDistributionType(),
      memberCount: distribution.memberCount,
      shares: distribution.shares,
      societyProfitShare: profitSplit.societyShare,
      investorProfitShare: profitSplit.investorShare,
      societyOwnershipPct: capitalSplit.societyOwnershipPct,
      investorOwnershipPct: capitalSplit.investorOwnershipPct,
      distributionKind: outcomeType === 'loss' ? 'loss' : 'sale',
      notes: notes?.trim()
        || `Liquidation net ${formatMoney(netProceeds, 2)} (sale ${formatMoney(grossSale, 2)} − costs ${formatMoney(costs, 2)} − tax ${formatMoney(taxAmt, 2)}) · capital ${formatMoney(capital, 2)} across ${related.length} investment(s)`,
      recordedBy: String(recordedBy || 'Admin').trim(),
    }, session);

    const lockNote = `Closed/sold via ${saleCode}. Society ${investment.societyOwnershipPct}% / Investor ${investment.investorOwnershipPct}%. Group capital ${formatMoney(capital, 2)}.`;
    const now = new Date();
    await Investment.updateMany(
      { _id: { $in: relatedIds } },
      {
        $set: {
          status: 'closed',
          saleAmount: grossSale,
          outcomeType: outcomeType === 'break_even' ? 'profit' : outcomeType,
          investorProfitBalance: 0,
          soldAt: now,
          closedAt: now,
          ledgerLockedAt: now,
          ledgerLockedBy: String(recordedBy || 'Admin').trim(),
          updatedAt: now,
          ...(bankLedger?.entry?._id ? { bankLedgerEntryId: bankLedger.entry._id } : {}),
        },
      },
      sessionOpt(session)
    );

    // Append lock note + group P&L on primary only (avoid double-counting across siblings).
    const primaryFresh = await bindSession(Investment.findById(investment._id), session);
    if (primaryFresh) {
      primaryFresh.profit = money(Number(primaryFresh.profit || 0) + Math.max(netProfit, 0));
      primaryFresh.notes = [primaryFresh.notes || '', notes?.trim() || '', lockNote].filter(Boolean).join(' | ');
      await primaryFresh.save(sessionOpt(session));
    }

    const closedPrimary = await bindSession(
      Investment.findById(investment._id)
        .populate('investor', 'name email role phone')
        .populate('projectManager', 'name email role'),
      session
    );

    return {
      investment: closedPrimary || investment,
      sale,
      record,
      relatedInvestmentIds: relatedIds,
      settlement: {
        ...settlementPlan,
        societyCapitalReturn: societySavingsRefund,
        relatedCount: related.length,
      },
      savingsUpdate,
      distribution,
      bankLedger,
      investorLedger,
      message: `Project ${investment.investmentCode} sold/closed (${saleCode}). Capital ${formatMoney(capital, 2)} across ${related.length} investment(s). Net ${formatMoney(netProceeds, 2)}. Ledger locked.`,
    };
  });

  // Notifications outside the transaction
  try {
    await createAdminNotification({
      type: 'general',
      title: `Project closed: ${result.investment.investmentCode}`,
      message: result.message,
      relatedId: result.investment._id,
      relatedModel: 'Investment',
      targetRoles: ['ceo', 'cashier'],
    });
  } catch (_) { /* non-fatal */ }

  if (result.investment?.investor) {
    await createMemberNotification({
      memberId: result.investment.investor._id || result.investment.investor,
      type: 'general',
      title: `Project settled: ${result.investment.investmentCode}`,
      message: `Your ownership share was settled for ${formatMoney(result.settlement.investorPayout, 2)}.`,
      relatedId: result.investment._id,
      relatedModel: 'Investment',
    }).catch(() => {});
  }

  return result;
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
  computeProjectLiquidationSettlement,
  assertNotLocked,
  getActiveProject,
  listRelatedActiveInvestments,
  recordExternalInvestment,
  recordMonthlyProjectReturn,
  liquidateProject,
  listExternalCapitalQueue,
  listActiveMonthlyProjects,
};
