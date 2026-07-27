const User = require('../models/User');
const ProfitDistribution = require('../models/ProfitDistribution');
const InvestmentProfit = require('../models/InvestmentProfit');
const { getInvestmentByCode, refundToTotalSavings } = require('./investmentService');
const { getDistributionType, getDividendWeights } = require('./societyConfig');

function getActiveMembersFilter() {
  return { role: 'member', status: { $nin: ['inactive', 'deleted'] } };
}

function calculateDividendShares(members, totalAmount) {
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
  const members = await User.find(getActiveMembersFilter());
  const sharePlan = calculateDividendShares(members, totalAmount);
  const { savingsWeight, profitWeight } = getDividendWeights();

  return {
    totalAmount: Number(totalAmount) || 0,
    memberCount: members.length,
    savingsWeight,
    profitWeight,
    preview: sharePlan.map((item) => ({
      memberId: item.member._id,
      memberName: item.member.name,
      savings: Number(item.member.savings || 0),
      profit: Number(item.member.profit || 0),
      weight: item.weight,
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

  const members = await User.find(getActiveMembersFilter());
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
    distributionType: 'dividend_auto',
    memberCount: members.length,
    shares,
    notes: notes?.trim() || 'Automatic dividend based on savings and profit.',
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

  if (distributionType === 'proportional') {
    const totalSavings = members.reduce((sum, member) => sum + Number(member.savings || 0), 0);
    if (totalSavings <= 0) {
      return calculateMemberShares(members, normalizedTotal, 'equal');
    }

    let allocated = 0;
    const shares = members.map((member, index) => {
      const savings = Number(member.savings || 0);
      let amount = Number(((savings / totalSavings) * normalizedTotal).toFixed(2));

      if (index === members.length - 1) {
        amount = Number((normalizedTotal - allocated).toFixed(2));
      } else {
        allocated += amount;
      }

      return {
        member,
        amount: Math.max(amount, 0),
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

  const societyDistributionType = getDistributionType();
  const distribution = await distributeAmountToMembers({
    totalAmount: normalizedTotal,
    distributionType: societyDistributionType,
    distributedBy,
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
  distributionType = 'equal',
  distributedBy = 'Admin',
}) {
  const members = await User.find(getActiveMembersFilter());
  if (!members.length) {
    const error = new Error('No members available for profit distribution.');
    error.status = 400;
    throw error;
  }

  const societyDistributionType = getDistributionType();
  const sharePlan = calculateMemberShares(members, totalAmount, societyDistributionType);
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
  };
}

async function applyLossToMembers({
  totalLoss,
  distributedBy = 'Admin',
}) {
  const members = await User.find(getActiveMembersFilter());
  if (!members.length) {
    const error = new Error('No members available for loss distribution.');
    error.status = 400;
    throw error;
  }

  const societyDistributionType = getDistributionType();
  const sharePlan = calculateMemberShares(members, totalLoss, societyDistributionType);
  const shares = [];

  for (const item of sharePlan) {
    let remaining = Number(item.amount || 0);
    const previousProfit = Number(item.member.profit || 0);
    const previousSavings = Number(item.member.savings || 0);

    const profitDeduction = Math.min(previousProfit, remaining);
    item.member.profit = Number((previousProfit - profitDeduction).toFixed(2));
    remaining = Number((remaining - profitDeduction).toFixed(2));

    if (remaining > 0) {
      item.member.savings = Math.max(0, Number((previousSavings - remaining).toFixed(2)));
    }

    await item.member.save();

    shares.push({
      member: item.member._id,
      memberName: item.member.name,
      amount: Number(item.amount || 0),
      previousProfit,
      newProfit: item.member.profit,
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

async function assertInvestmentCanBeSold(investment) {
  if (investment.status === 'sold') {
    const error = new Error('This investment has already been sold.');
    error.status = 400;
    throw error;
  }

  const existingSale = await InvestmentProfit.findOne({ investment: investment._id });
  if (existingSale) {
    const error = new Error('This investment has already been sold.');
    error.status = 400;
    throw error;
  }
}

async function markInvestmentAsSold(investment, { saleAmount, outcomeType }) {
  investment.status = 'sold';
  investment.saleAmount = Number(saleAmount) || 0;
  investment.outcomeType = outcomeType;
  investment.soldAt = new Date();
  await investment.save();
}

async function recordInvestmentLoss({
  investmentCode,
  saleAmount,
  lossAmount,
  notes = '',
  recordedBy = 'Admin',
}) {
  const investment = await getInvestmentByCode(investmentCode);
  await assertInvestmentCanBeSold(investment);
  const normalizedSaleAmount = Number(saleAmount) || 0;
  const investedAmount = Number(investment.amount || 0);
  let normalizedLossAmount = Number(lossAmount);

  if ((!normalizedLossAmount || normalizedLossAmount <= 0) && normalizedSaleAmount >= 0) {
    normalizedLossAmount = Number((investedAmount - normalizedSaleAmount).toFixed(2));
  }

  if (!normalizedLossAmount || normalizedLossAmount <= 0) {
    const error = new Error('Loss amount must be greater than zero. Enter a sale amount lower than the investment.');
    error.status = 400;
    throw error;
  }

  if (normalizedSaleAmount > investedAmount) {
    const error = new Error('Sale amount is higher than the investment. Use the profit form instead.');
    error.status = 400;
    throw error;
  }

  const societyDistributionType = getDistributionType();
  const distribution = await applyLossToMembers({
    totalLoss: normalizedLossAmount,
    distributedBy: recordedBy,
  });

  let savingsUpdate = null;
  if (normalizedSaleAmount > 0) {
    savingsUpdate = await refundToTotalSavings(normalizedSaleAmount);
  }

  investment.profit = Number((Number(investment.profit || 0) - normalizedLossAmount).toFixed(2));

  const record = await InvestmentProfit.create({
    investment: investment._id,
    investmentCode: investment.investmentCode,
    sector: investment.sector,
    partner: investment.partner,
    investmentAmount: investedAmount,
    saleAmount: normalizedSaleAmount,
    profitAmount: normalizedLossAmount,
    outcomeType: 'loss',
    distributionType: societyDistributionType,
    memberCount: distribution.memberCount,
    shares: distribution.shares,
    notes: notes?.trim() || '',
    recordedBy: recordedBy?.trim() || 'Admin',
  });

  await markInvestmentAsSold(investment, {
    saleAmount: normalizedSaleAmount,
    outcomeType: 'loss',
  });

  return {
    record,
    investment,
    savingsUpdate,
    updatedMembers: distribution.updatedMembers,
    calculatedLoss: normalizedLossAmount,
    saleReturned: normalizedSaleAmount,
  };
}

async function recordInvestmentProfit({
  investmentCode,
  saleAmount,
  profitAmount,
  distributionType = 'equal',
  notes = '',
  recordedBy = 'Admin',
}) {
  const investment = await getInvestmentByCode(investmentCode);
  await assertInvestmentCanBeSold(investment);
  const normalizedSaleAmount = Number(saleAmount) || 0;
  let normalizedProfitAmount = Number(profitAmount);

  if ((!normalizedProfitAmount || normalizedProfitAmount <= 0) && normalizedSaleAmount > 0) {
    normalizedProfitAmount = Number((normalizedSaleAmount - Number(investment.amount || 0)).toFixed(2));
  }

  if (!normalizedProfitAmount || normalizedProfitAmount <= 0) {
    const error = new Error('Profit amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const societyDistributionType = getDistributionType();
  const distribution = await distributeAmountToMembers({
    totalAmount: normalizedProfitAmount,
    distributionType: societyDistributionType,
    distributedBy: recordedBy,
  });

  let savingsUpdate = null;
  const principalReturn = normalizedSaleAmount > 0
    ? Number((normalizedSaleAmount - normalizedProfitAmount).toFixed(2))
    : 0;

  if (principalReturn > 0) {
    savingsUpdate = await refundToTotalSavings(principalReturn);
  }

  investment.profit = Number(investment.profit || 0) + normalizedProfitAmount;

  const record = await InvestmentProfit.create({
    investment: investment._id,
    investmentCode: investment.investmentCode,
    sector: investment.sector,
    partner: investment.partner,
    investmentAmount: Number(investment.amount || 0),
    saleAmount: normalizedSaleAmount,
    profitAmount: normalizedProfitAmount,
    outcomeType: 'profit',
    distributionType: societyDistributionType,
    memberCount: distribution.memberCount,
    shares: distribution.shares,
    notes: notes?.trim() || '',
    recordedBy: recordedBy?.trim() || 'Admin',
  });

  await markInvestmentAsSold(investment, {
    saleAmount: normalizedSaleAmount,
    outcomeType: 'profit',
  });

  let bankLedger = null;
  let ledgerWarning = null;
  if (normalizedSaleAmount > 0) {
    try {
      const { creditInbound } = require('./bankLedgerService');
      bankLedger = await creditInbound({
        type: 'project_sale',
        amount: normalizedSaleAmount,
        referenceType: 'InvestmentProfit',
        referenceId: record._id,
        note: `Project sale/return ${investment.investmentCode || ''}`,
        createdBy: recordedBy,
      });
    } catch (error) {
      console.error('[recordInvestmentProfit] bank ledger credit failed:', error.message);
      ledgerWarning = error.message;
    }
  }

  return {
    record,
    investment,
    savingsUpdate,
    updatedMembers: distribution.updatedMembers,
    calculatedProfit: normalizedProfitAmount,
    principalReturned: principalReturn,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? null,
    ledgerWarning,
  };
}

async function getInvestmentProfitHistory(limit = 20) {
  return InvestmentProfit.find({})
    .sort({ createdAt: -1 })
    .limit(limit);
}

async function lookupInvestmentForProfit(investmentCode) {
  const investment = await getInvestmentByCode(investmentCode);
  await assertInvestmentCanBeSold(investment);
  return {
    _id: investment._id,
    investmentCode: investment.investmentCode,
    investorName: investment.investorName || investment.partner,
    dateOfBirth: investment.dateOfBirth,
    location: investment.location || investment.sector,
    sector: investment.sector,
    partner: investment.partner,
    amount: investment.amount,
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
};
