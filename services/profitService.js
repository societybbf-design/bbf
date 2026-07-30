const User = require('../models/User');
const ProfitDistribution = require('../models/ProfitDistribution');
const InvestmentProfit = require('../models/InvestmentProfit');
const { getInvestmentByCode, refundToTotalSavings } = require('./investmentService');
const {
  getDistributionType,
  getDividendWeights,
  isEqualShareSociety,
} = require('./societyConfig');

/**
 * Active members only (excludes pending/approved/blocked).
 * Optional asOfDate / yearMonth gates new members until profitEligibleFrom
 * (typically the 1st of the month after activation).
 * Profit eligibility is NOT reduced by late contribution payment, internal
 * borrow cover, or emergency-reserve cover — equal shares stay intact.
 */
function getActiveMembersFilter({ asOfDate = null, yearMonth = null } = {}) {
  const filter = {
    role: 'member',
    status: 'active',
    pendingEntryBuyIn: { $ne: true },
  };

  const cutoff = resolveProfitCutoffDate({ asOfDate, yearMonth });
  if (cutoff) {
    filter.$or = [
      { profitEligibleFrom: null },
      { profitEligibleFrom: { $exists: false } },
      { profitEligibleFrom: { $lte: cutoff } },
    ];
  }

  return filter;
}

function resolveProfitCutoffDate({ asOfDate = null, yearMonth = null } = {}) {
  if (yearMonth && /^\d{4}-\d{2}$/.test(String(yearMonth))) {
    const [year, month] = String(yearMonth).split('-').map(Number);
    return new Date(year, month - 1, 1);
  }
  if (asOfDate) {
    const d = new Date(asOfDate);
    if (!Number.isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
  }
  return null;
}

function memberBalanceWeight(member) {
  return Math.max(0, Number(member.savings || 0) + Number(member.profit || 0));
}

/**
 * Society rule: equal monthly contributions + equal profit shares.
 * When equal-share mode is on, never allow balance/proportional/weighted splits
 * that would reward higher deposits or balances with more profit.
 */
function resolveSocietyDistributionType(requestedType = null, { force = false } = {}) {
  if (isEqualShareSociety()) {
    return 'equal';
  }
  if (force && requestedType) {
    return requestedType;
  }
  return requestedType || getDistributionType();
}

async function listProfitEligibleMembers(options = {}) {
  const { bindSession } = require('./mongoTransaction');
  return bindSession(User.find(getActiveMembersFilter(options)), options.session || null);
}

function calculateDividendShares(members, totalAmount) {
  // Equal-share society: dividends must also be equal — no savings/profit weighting.
  if (isEqualShareSociety()) {
    return calculateMemberShares(members, totalAmount, 'equal');
  }

  if (!members.length) {
    return [];
  }

  const normalizedTotal = Number(totalAmount) || 0;
  if (normalizedTotal <= 0) {
    return [];
  }

  const { savingsWeight, profitWeight } = getDividendWeights();
  const weights = members.map((member) => {
    const savings = Number(member.savings || 0);
    const profit = Number(member.profit || 0);
    return Number(((savings * savingsWeight) + (profit * profitWeight)).toFixed(4));
  });

  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return calculateMemberShares(members, normalizedTotal, 'equal');
  }

  let allocated = 0;
  return members.map((member, index) => {
    let amount = Number(((weights[index] / totalWeight) * normalizedTotal).toFixed(2));
    if (index === members.length - 1) {
      amount = Number((normalizedTotal - allocated).toFixed(2));
    } else {
      allocated += amount;
    }

    return {
      member,
      amount: Math.max(amount, 0),
      weight: weights[index],
    };
  });
}

async function previewAutomaticDividend(totalAmount) {
  const members = await listProfitEligibleMembers();
  const sharePlan = calculateDividendShares(members, totalAmount);
  const { savingsWeight, profitWeight } = isEqualShareSociety()
    ? { savingsWeight: 0, profitWeight: 0 }
    : getDividendWeights();

  return {
    totalAmount: Number(totalAmount) || 0,
    memberCount: members.length,
    savingsWeight,
    profitWeight,
    distributionType: isEqualShareSociety() ? 'equal' : 'dividend_auto',
    preview: sharePlan.map((item) => ({
      memberId: item.member._id,
      memberName: item.member.name,
      savings: Number(item.member.savings || 0),
      profit: Number(item.member.profit || 0),
      weight: item.weight == null ? 1 : item.weight,
      dividendShare: item.amount,
    })),
  };
}

async function distributeAutomaticDividend({
  totalAmount,
  notes = '',
  distributedBy = 'Admin',
}) {
  const normalizedTotal = Number(totalAmount);
  if (!normalizedTotal || normalizedTotal <= 0) {
    const error = new Error('Dividend pool amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const members = await listProfitEligibleMembers();
  if (!members.length) {
    const error = new Error('No active members available for dividend distribution.');
    error.status = 400;
    throw error;
  }

  const sharePlan = calculateDividendShares(members, normalizedTotal);
  const shares = [];

  for (const item of sharePlan) {
    const previousProfit = Number(item.member.profit || 0);
    const newProfit = previousProfit + Number(item.amount || 0);
    item.member.profit = newProfit;
    await item.member.save();

    shares.push({
      member: item.member._id,
      memberName: item.member.name,
      amount: Number(item.amount || 0),
      previousProfit,
      newProfit,
      weight: item.weight,
    });
  }

  const profitDistribution = await ProfitDistribution.create({
    totalAmount: normalizedTotal,
    distributionType: isEqualShareSociety() ? 'equal' : 'dividend_auto',
    memberCount: members.length,
    shares,
    notes: notes?.trim() || (isEqualShareSociety()
      ? 'Equal dividend among active members (fixed contribution society — deposits cannot increase profit share).'
      : 'Automatic dividend based on savings and profit.'),
    distributedBy: distributedBy?.trim() || 'Admin',
  });

  return {
    distribution: profitDistribution,
    updatedMembers: shares.map((share) => ({
      memberId: share.member,
      memberName: share.memberName,
      share: share.amount,
      totalProfit: share.newProfit,
    })),
  };
}

function calculateMemberShares(members, totalAmount, distributionType = 'equal') {
  if (!members.length) {
    return [];
  }

  const normalizedTotal = Number(totalAmount) || 0;
  if (normalizedTotal <= 0) {
    return [];
  }

  // Absolute society rule: equal share mode never weights by deposits/balances.
  const effectiveType = isEqualShareSociety()
    ? 'equal'
    : (distributionType || getDistributionType());

  // balance / proportional only when society is NOT equal-share.
  if (effectiveType === 'proportional' || effectiveType === 'balance') {
    const weights = members.map((member) => memberBalanceWeight(member));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) {
      return calculateMemberShares(members, normalizedTotal, 'equal');
    }

    let allocated = 0;
    const shares = members.map((member, index) => {
      let amount = Number(((weights[index] / totalWeight) * normalizedTotal).toFixed(2));

      if (index === members.length - 1) {
        amount = Number((normalizedTotal - allocated).toFixed(2));
      } else {
        allocated += amount;
      }

      return {
        member,
        amount: Math.max(amount, 0),
        weight: weights[index],
      };
    });

    return shares;
  }

  const equalShare = Number((normalizedTotal / members.length).toFixed(2));
  let allocated = 0;

  return members.map((member, index) => {
    let amount = equalShare;
    if (index === members.length - 1) {
      amount = Number((normalizedTotal - allocated).toFixed(2));
    } else {
      allocated += amount;
    }

    return {
      member,
      amount: Math.max(amount, 0),
      weight: 1,
    };
  });
}

async function distributeProfit({
  totalAmount,
  distributionType = 'equal',
  notes = '',
  distributedBy = 'Admin',
}) {
  const normalizedTotal = Number(totalAmount);
  if (!normalizedTotal || normalizedTotal <= 0) {
    const error = new Error('Profit amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const societyDistributionType = getDistributionType();
  const distribution = await distributeAmountToMembers({
    totalAmount: normalizedTotal,
    distributionType: societyDistributionType,
    distributedBy,
    yearMonth,
    asOfDate: now,
  });

  const profitDistribution = await ProfitDistribution.create({
    totalAmount: normalizedTotal,
    distributionType: societyDistributionType,
    memberCount: distribution.memberCount,
    shares: distribution.shares,
    notes: notes?.trim() || '',
    distributedBy: distributedBy?.trim() || 'Admin',
  });

  return {
    distribution: profitDistribution,
    updatedMembers: distribution.updatedMembers,
  };
}

async function getProfitHistory(limit = 20) {
  return ProfitDistribution.find({})
    .sort({ createdAt: -1 })
    .limit(limit);
}

async function getLatestDistribution() {
  const [general, investment] = await Promise.all([
    ProfitDistribution.findOne({}).sort({ createdAt: -1 }),
    InvestmentProfit.findOne({}).sort({ createdAt: -1 }),
  ]);

  if (!general && !investment) {
    return null;
  }

  if (!general) {
    return {
      createdAt: investment.createdAt,
      totalAmount: investment.profitAmount,
      distributionType: investment.distributionType,
      source: 'investment',
      investmentCode: investment.investmentCode,
    };
  }

  if (!investment) {
    return general;
  }

  if (new Date(investment.createdAt) > new Date(general.createdAt)) {
    return {
      createdAt: investment.createdAt,
      totalAmount: investment.profitAmount,
      distributionType: investment.distributionType,
      source: 'investment',
      investmentCode: investment.investmentCode,
    };
  }

  return general;
}

async function getMemberProfitHistory(memberId, limit = 10) {
  const [distributions, investmentProfits] = await Promise.all([
    ProfitDistribution.find({ 'shares.member': memberId })
      .sort({ createdAt: -1 })
      .limit(limit),
    InvestmentProfit.find({ 'shares.member': memberId })
      .sort({ createdAt: -1 })
      .limit(limit),
  ]);

  const generalHistory = distributions.map((distribution) => {
    const share = distribution.shares.find((item) => String(item.member) === String(memberId));
    return {
      id: distribution._id,
      source: 'general',
      investmentCode: null,
      amount: share?.amount || 0,
      totalProfitAfter: share?.newProfit || 0,
      distributionType: distribution.distributionType,
      notes: distribution.notes,
      distributedBy: distribution.distributedBy,
      createdAt: distribution.createdAt,
    };
  });

  const investmentHistory = investmentProfits.map((record) => {
    const share = record.shares.find((item) => String(item.member) === String(memberId));
    const shareAmount = share?.amount || 0;
    const isLoss = record.outcomeType === 'loss';
    return {
      id: record._id,
      source: isLoss ? 'investment-loss' : 'investment',
      investmentCode: record.investmentCode,
      amount: isLoss ? -shareAmount : shareAmount,
      totalProfitAfter: share?.newProfit || 0,
      distributionType: record.distributionType,
      outcomeType: record.outcomeType || 'profit',
      notes: record.notes,
      distributedBy: record.recordedBy,
      createdAt: record.createdAt,
    };
  });

  return [...generalHistory, ...investmentHistory]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

async function distributeAmountToMembers({
  totalAmount,
  distributionType = null,
  distributedBy = 'Admin',
  asOfDate = null,
  yearMonth = null,
  forceDistributionType = false,
  session = null,
}) {
  const { sessionOpt } = require('./mongoTransaction');
  const members = await listProfitEligibleMembers({ asOfDate, yearMonth, session });
  if (!members.length) {
    const error = new Error('No eligible active members available for profit distribution.');
    error.status = 400;
    throw error;
  }

  const resolvedType = resolveSocietyDistributionType(distributionType, {
    force: forceDistributionType,
  });
  const sharePlan = calculateMemberShares(members, totalAmount, resolvedType);
  const shares = [];

  for (const item of sharePlan) {
    const credit = Number((Number(item.amount || 0)).toFixed(2));
    if (!(credit > 0)) continue;
    const previousProfit = Number(item.member.profit || 0);
    const updated = await User.findOneAndUpdate(
      { _id: item.member._id },
      { $inc: { profit: credit } },
      sessionOpt(session, { new: true })
    );
    if (!updated) {
      const error = new Error('Unable to credit profit to a member.');
      error.status = 409;
      throw error;
    }
    const newProfit = Number(updated.profit || 0);
    item.member.profit = newProfit;

    shares.push({
      member: item.member._id,
      memberName: item.member.name,
      amount: credit,
      previousProfit,
      newProfit,
      weight: item.weight,
    });
  }

  return {
    shares,
    memberCount: members.length,
    distributionType: resolvedType,
    yearMonth: yearMonth || null,
    updatedMembers: shares.map((share) => ({
      memberId: share.member,
      memberName: share.memberName,
      share: share.amount,
      totalProfit: share.newProfit,
    })),
  };
}

async function applyLossToMembers({
  totalLoss,
  distributedBy = 'Admin',
  asOfDate = null,
  yearMonth = null,
  session = null,
}) {
  const { sessionOpt } = require('./mongoTransaction');
  const members = await listProfitEligibleMembers({ asOfDate, yearMonth, session });
  if (!members.length) {
    const error = new Error('No eligible active members available for loss distribution.');
    error.status = 400;
    throw error;
  }

  const societyDistributionType = getDistributionType();
  const sharePlan = calculateMemberShares(members, totalLoss, societyDistributionType);
  const shares = [];

  for (const item of sharePlan) {
    let remaining = Number((Number(item.amount || 0)).toFixed(2));
    const previousProfit = Number(item.member.profit || 0);
    const previousSavings = Number(item.member.savings || 0);

    const profitDeduction = Number(Math.min(previousProfit, remaining).toFixed(2));
    remaining = Number((remaining - profitDeduction).toFixed(2));
    const savingsDeduction = remaining > 0
      ? Number(Math.min(previousSavings, remaining).toFixed(2))
      : 0;

    const updated = await User.findOneAndUpdate(
      { _id: item.member._id },
      {
        $inc: {
          ...(profitDeduction > 0 ? { profit: -profitDeduction } : {}),
          ...(savingsDeduction > 0 ? { savings: -savingsDeduction } : {}),
        },
      },
      sessionOpt(session, { new: true })
    );
    if (!updated) {
      const error = new Error('Unable to apply loss to a member.');
      error.status = 409;
      throw error;
    }
    item.member.profit = updated.profit;
    item.member.savings = updated.savings;

    shares.push({
      member: item.member._id,
      memberName: item.member.name,
      amount: Number(item.amount || 0),
      previousProfit,
      newProfit: Number(updated.profit || 0),
      deductedFromProfit: profitDeduction,
      deductedFromSavings: savingsDeduction,
    });
  }

  return {
    shares,
    memberCount: members.length,
    updatedMembers: shares.map((share) => ({
      memberId: share.member,
      memberName: share.memberName,
      share: share.amount,
      totalProfit: share.newProfit,
    })),
    distributedBy,
  };
}

async function assertInvestmentCanBeSold(investment, { session = null } = {}) {
  if (investment.ledgerLockedAt || investment.status === 'closed') {
    const error = new Error('This project ledger is locked after sale/settlement.');
    error.status = 409;
    throw error;
  }

  if (investment.status === 'sold') {
    const error = new Error('This investment has already been sold.');
    error.status = 400;
    throw error;
  }

  const original = Number((Number(investment.amount || 0)).toFixed(2));
  const liquidated = Number((Number(investment.liquidatedPrincipal || 0)).toFixed(2));
  const remaining = Number(Math.max(0, original - liquidated).toFixed(2));
  if (remaining <= 0.001) {
    const error = new Error('This investment has no remaining principal to close.');
    error.status = 409;
    throw error;
  }

  // Legacy full-close guard: if prior sale/loss exists and liquidatedPrincipal was never tracked, block.
  if (liquidated <= 0) {
    const { bindSession } = require('./mongoTransaction');
    const existingSale = await bindSession(
      InvestmentProfit.findOne({
        investment: investment._id,
        distributionKind: { $in: ['sale', 'loss'] },
        isPartial: { $ne: true },
      }),
      session
    );
    if (existingSale) {
      const error = new Error('This investment has already been sold.');
      error.status = 400;
      throw error;
    }
  }
}

async function markInvestmentAsSold(investment, {
  saleAmount,
  outcomeType,
  lockLedger = false,
  recordedBy = 'Admin',
  session = null,
}) {
  const { sessionOpt } = require('./mongoTransaction');
  const mappedOutcome = outcomeType === 'break_even' ? 'profit' : outcomeType;
  investment.status = lockLedger ? 'closed' : 'sold';
  investment.saleAmount = Number(saleAmount) || 0;
  investment.outcomeType = ['profit', 'loss'].includes(mappedOutcome) ? mappedOutcome : 'profit';
  investment.soldAt = new Date();
  if (lockLedger) {
    investment.closedAt = new Date();
    investment.ledgerLockedAt = new Date();
    investment.ledgerLockedBy = String(recordedBy || 'Admin').trim();
  }
  await investment.save(sessionOpt(session));
}

/**
 * Unified investment close: profit, loss, break-even, and partial liquidation.
 * Entire write path runs inside withMongoTransaction for atomic rollback.
 */
async function closeInvestmentReturn({
  investmentCode,
  saleAmount,
  profitAmount = null,
  lossAmount = null,
  principalToClose = null,
  notes = '',
  recordedBy = 'Admin',
  recordedByUserId = null,
  clientRequestId = '',
  actor = null,
  ip = '',
  forceOutcome = null,
} = {}) {
  const { computeInvestmentClosePlan, money } = require('./investmentCloseMath');
  const { withMongoTransaction, bindSession, sessionOpt, createWithSession } = require('./mongoTransaction');
  const { creditInbound } = require('./bankLedgerService');

  const investmentProbe = await getInvestmentByCode(investmentCode);
  await assertInvestmentCanBeSold(investmentProbe);

  // Co-funded / ownership projects use the dedicated liquidation settlement path.
  if (Number(investmentProbe.investorOwnershipPct || 0) > 0) {
    const { liquidateProject } = require('./projectFinanceService');
    const normalizedSaleAmount = money(saleAmount);
    let inferredSale = normalizedSaleAmount;
    if ((!inferredSale || inferredSale <= 0) && Number(profitAmount) > 0) {
      inferredSale = money(Number(investmentProbe.amount || 0) + Number(profitAmount));
    }
    return liquidateProject({
      investmentId: investmentProbe._id,
      saleAmount: inferredSale,
      notes,
      recordedBy,
    });
  }

  const result = await withMongoTransaction(async (session) => {
    const investment = await bindSession(
      require('../models/Investment').findById(investmentProbe._id),
      session
    );
    if (!investment) {
      const error = new Error('Investment not found.');
      error.status = 404;
      throw error;
    }
    await assertInvestmentCanBeSold(investment, { session });

    const remaining = money(Math.max(
      0,
      money(investment.amount) - money(investment.liquidatedPrincipal || 0)
    ));

    let sale = money(saleAmount);
    // Legacy: profit form may omit sale and send profit only → infer sale = remaining + profit.
    if (!(sale > 0) && Number(profitAmount) > 0 && forceOutcome !== 'loss') {
      sale = money(remaining + Number(profitAmount));
    }
    // Legacy loss form: infer sale from remaining − loss when sale omitted.
    if (!(sale >= 0) && Number(lossAmount) > 0) {
      sale = money(Math.max(0, remaining - Number(lossAmount)));
    }

    let closePrincipal = principalToClose;
    // If force loss/profit without explicit principal, close remaining (or principal implied by sale+pnl).
    if ((closePrincipal === null || closePrincipal === undefined || closePrincipal === '')
      && forceOutcome === 'loss'
      && Number(lossAmount) > 0
      && sale >= 0) {
      closePrincipal = money(sale + Number(lossAmount));
    }

    const plan = computeInvestmentClosePlan({
      originalAmount: investment.amount,
      liquidatedPrincipal: investment.liquidatedPrincipal || 0,
      saleAmount: sale,
      principalToClose: closePrincipal,
    });

    if (forceOutcome === 'loss' && plan.outcomeType !== 'loss') {
      const error = new Error('Sale amount is not below principal closed. Use the profit form for gains or break-even.');
      error.status = 400;
      throw error;
    }
    if (forceOutcome === 'profit' && plan.outcomeType === 'loss') {
      // Allow unified profit button to record losses when sale < principal.
      // (Cashier "Record & Distribute" can close either outcome.)
    }

    const societyDistributionType = getDistributionType();
    let distribution = {
      shares: [],
      memberCount: 0,
      updatedMembers: [],
      distributionType: societyDistributionType,
    };

    if (plan.outcomeType === 'profit' && plan.profitAmount > 0) {
      distribution = await distributeAmountToMembers({
        totalAmount: plan.profitAmount,
        distributionType: societyDistributionType,
        distributedBy: recordedBy,
        session,
      });
    } else if (plan.outcomeType === 'loss' && plan.lossAmount > 0) {
      distribution = await applyLossToMembers({
        totalLoss: plan.lossAmount,
        distributedBy: recordedBy,
        session,
      });
    }

    let savingsUpdate = null;
    if (plan.principalRefund > 0) {
      savingsUpdate = await refundToTotalSavings(plan.principalRefund, { session });
    }

    investment.liquidatedPrincipal = plan.liquidatedPrincipalAfter;
    investment.cumulativeSaleAmount = money(
      Number(investment.cumulativeSaleAmount || 0) + plan.saleAmount
    );
    investment.saleAmount = investment.cumulativeSaleAmount;
    if (plan.outcomeType === 'profit') {
      investment.profit = money(Number(investment.profit || 0) + plan.profitAmount);
    } else if (plan.outcomeType === 'loss') {
      investment.profit = money(Number(investment.profit || 0) - plan.lossAmount);
    }

    const recordedAt = new Date();
    const distributionKind = plan.outcomeType === 'loss' ? 'loss' : 'sale';
    const recordAmount = plan.outcomeType === 'loss' ? plan.lossAmount : plan.profitAmount;

    const breakdown = {
      originalAmount: plan.originalAmount,
      alreadyLiquidated: plan.alreadyLiquidated,
      principalClosed: plan.closePrincipal,
      saleAmount: plan.saleAmount,
      pnl: plan.pnl,
      profitAmount: plan.profitAmount,
      lossAmount: plan.lossAmount,
      principalRefund: plan.principalRefund,
      remainingPrincipalAfter: plan.remainingAfter,
      isPartial: plan.isPartial,
      outcomeType: plan.outcomeType,
      memberCount: distribution.memberCount,
      shareTotal: money((distribution.shares || []).reduce((sum, row) => sum + Number(row.amount || 0), 0)),
      recordedBy: String(recordedBy || 'Admin').trim(),
      recordedByUserId: recordedByUserId || actor?.id || actor?._id || null,
      recordedAt: recordedAt.toISOString(),
      clientRequestId: String(clientRequestId || '').trim(),
    };

    const record = await createWithSession(InvestmentProfit, {
      investment: investment._id,
      investmentCode: investment.investmentCode,
      sector: investment.sector,
      partner: investment.partner,
      investmentAmount: plan.originalAmount,
      saleAmount: plan.saleAmount,
      profitAmount: recordAmount,
      lossAmount: plan.lossAmount,
      principalClosed: plan.closePrincipal,
      remainingPrincipalAfter: plan.remainingAfter,
      isPartial: plan.isPartial,
      outcomeType: plan.outcomeType === 'break_even' ? 'break_even' : plan.outcomeType,
      distributionType: societyDistributionType,
      memberCount: distribution.memberCount,
      shares: distribution.shares,
      societyProfitShare: plan.profitAmount,
      investorProfitShare: 0,
      societyOwnershipPct: Number(investment.societyOwnershipPct || 100),
      investorOwnershipPct: Number(investment.investorOwnershipPct || 0),
      distributionKind,
      notes: notes?.trim() || '',
      recordedBy: String(recordedBy || 'Admin').trim(),
      recordedByUserId: recordedByUserId || actor?.id || actor?._id || null,
      clientRequestId: String(clientRequestId || '').trim(),
      breakdown,
      createdAt: recordedAt,
    }, session);

    if (!plan.isPartial) {
      await markInvestmentAsSold(investment, {
        saleAmount: investment.cumulativeSaleAmount,
        outcomeType: plan.outcomeType,
        lockLedger: true,
        recordedBy,
        session,
      });
    } else {
      const mapped = plan.outcomeType === 'break_even' ? 'profit' : plan.outcomeType;
      if (['profit', 'loss'].includes(mapped)) {
        investment.outcomeType = mapped;
      }
      await investment.save(sessionOpt(session));
    }

    let bankLedger = null;
    if (plan.saleAmount > 0) {
      bankLedger = await creditInbound({
        type: 'project_sale',
        amount: plan.saleAmount,
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        note: `${plan.isPartial ? 'Partial' : 'Full'} project sale/return ${investment.investmentCode || ''} (${plan.outcomeType})`,
        createdBy: recordedBy,
        session,
      });
      record.bankLedgerEntryId = bankLedger?.entry?._id || null;
      await record.save(sessionOpt(session));
    }

    return {
      record,
      investment,
      savingsUpdate,
      updatedMembers: distribution.updatedMembers,
      calculatedProfit: plan.profitAmount,
      calculatedLoss: plan.lossAmount,
      principalReturned: plan.principalRefund,
      principalClosed: plan.closePrincipal,
      remainingPrincipal: plan.remainingAfter,
      isPartial: plan.isPartial,
      outcomeType: plan.outcomeType,
      saleReturned: plan.saleAmount,
      bankLedger,
      bookBalance: bankLedger?.ledger?.bookBalance ?? null,
      breakdown,
      transactional: true,
    };
  });

  // Post-commit audit (outside the transaction).
  try {
    const { recordAdminActivity } = require('./activityLogService');
    await recordAdminActivity({
      action: 'investment_close_recorded',
      actor: actor || null,
      details: {
        investmentCode: result.investment?.investmentCode || investmentCode,
        investmentId: result.investment?._id,
        recordId: result.record?._id,
        outcomeType: result.outcomeType,
        saleAmount: result.saleReturned,
        principalClosed: result.principalClosed,
        profitAmount: result.calculatedProfit,
        lossAmount: result.calculatedLoss,
        isPartial: result.isPartial,
        remainingPrincipal: result.remainingPrincipal,
        memberCount: result.updatedMembers?.length || 0,
        bankLedgerEntryId: result.record?.bankLedgerEntryId,
        breakdown: result.breakdown,
        clientRequestId: String(clientRequestId || '').trim(),
      },
      ip: ip || '',
    });
  } catch (error) {
    console.warn('[closeInvestmentReturn] activity log failed:', error.message);
  }

  return result;
}

async function recordInvestmentLoss(params = {}) {
  const remainingHint = Number(params.saleAmount);
  return closeInvestmentReturn({
    ...params,
    forceOutcome: 'loss',
    // Prefer explicit lossAmount when provided; math derives principal from sale+loss when needed.
    lossAmount: params.lossAmount,
    saleAmount: Number.isFinite(remainingHint) ? remainingHint : params.saleAmount,
  });
}

async function recordInvestmentProfit(params = {}) {
  return closeInvestmentReturn(params);
}

async function getInvestmentProfitHistory(limit = 20) {
  return InvestmentProfit.find({})
    .sort({ createdAt: -1 })
    .limit(limit);
}

async function lookupInvestmentForProfit(investmentCode) {
  const { money } = require('./investmentCloseMath');
  const investment = await getInvestmentByCode(investmentCode);
  await assertInvestmentCanBeSold(investment);
  const originalAmount = money(investment.amount);
  const liquidatedPrincipal = money(investment.liquidatedPrincipal || 0);
  const remainingPrincipal = money(Math.max(0, originalAmount - liquidatedPrincipal));
  return {
    _id: investment._id,
    investmentCode: investment.investmentCode,
    investorName: investment.investorName || investment.partner,
    dateOfBirth: investment.dateOfBirth,
    location: investment.location || investment.sector,
    sector: investment.sector,
    partner: investment.partner,
    amount: investment.amount,
    investmentAmount: originalAmount,
    liquidatedPrincipal,
    remainingPrincipal,
    cumulativeSaleAmount: money(investment.cumulativeSaleAmount || 0),
    profit: investment.profit,
    status: investment.status || 'active',
    saleAmount: investment.saleAmount,
    outcomeType: investment.outcomeType,
    soldAt: investment.soldAt,
    notes: investment.notes,
    createdAt: investment.createdAt,
    createdBy: investment.createdBy,
  };
}

module.exports = {
  applyLossToMembers,
  calculateMemberShares,
  memberBalanceWeight,
  getActiveMembersFilter,
  resolveProfitCutoffDate,
  resolveSocietyDistributionType,
  listProfitEligibleMembers,
  distributeProfit,
  distributeAmountToMembers,
  getProfitHistory,
  getLatestDistribution,
  getMemberProfitHistory,
  getInvestmentProfitHistory,
  lookupInvestmentForProfit,
  previewAutomaticDividend,
  distributeAutomaticDividend,
  recordInvestmentLoss,
  recordInvestmentProfit,
  closeInvestmentReturn,
};
