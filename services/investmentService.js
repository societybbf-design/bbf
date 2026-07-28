const { formatMoney } = require('./moneyFormat');
const Investment = require('../models/Investment');
const User = require('../models/User');
const InvestmentProfit = require('../models/InvestmentProfit');
const { createMemberNotification } = require('./memberNotificationService');
const { createAdminNotification } = require('./adminNotificationService');

function splitAmountEqually(amount, memberCount) {
  const normalizedAmount = Number(amount);
  const equalShare = Number((normalizedAmount / memberCount).toFixed(2));
  let allocated = 0;

  return Array.from({ length: memberCount }, (_, index) => {
    if (index === memberCount - 1) {
      return Number((normalizedAmount - allocated).toFixed(2));
    }
    allocated += equalShare;
    return equalShare;
  });
}

function calculateInvestmentPerformance({ amount, withdrawals = 0, profit = 0, allocation = '' }) {
  const normalizedAmount = Number(amount) || 0;
  const normalizedWithdrawals = Number(withdrawals) || 0;
  const normalizedProfit = Number(profit) || 0;
  const balance = Math.max(normalizedAmount + normalizedProfit - normalizedWithdrawals, 0);

  return {
    allocation,
    balance,
    netProfit: normalizedProfit,
    remainingAfterWithdrawals: normalizedAmount - normalizedWithdrawals,
  };
}

async function getSavingsPool() {
  const members = await User.find({ role: 'member', status: { $ne: 'deleted' } });
  const totalSavings = members.reduce((sum, member) => sum + Number(member.savings || 0), 0);
  const totalAdvance = members.reduce((sum, member) => sum + Number(member.advanceBalance || 0), 0);

  return {
    members,
    totalSavings,
    totalAdvance,
  };
}

async function deductFromTotalSavings(amount) {
  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Investment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const { members, totalSavings } = await getSavingsPool();
  if (!members.length) {
    const error = new Error('No members available to fund this investment.');
    error.status = 400;
    throw error;
  }

  if (normalizedAmount > totalSavings) {
    const error = new Error(`Insufficient total savings. Available: ${formatMoney(totalSavings, 2)}`);
    error.status = 400;
    throw error;
  }

  const equalShares = splitAmountEqually(normalizedAmount, members.length);

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const deduction = equalShares[index];
    member.savings = Math.max(0, Number(member.savings || 0) - deduction);
    await member.save();
  }

  return {
    deductedAmount: normalizedAmount,
    totalSavingsBefore: totalSavings,
    totalSavingsAfter: Number((totalSavings - normalizedAmount).toFixed(2)),
  };
}

/**
 * Fund an investment share-by-share from member savings then advance.
 * Members who cannot cover their equal share are flagged unpaid — project still proceeds.
 */
async function fundInvestmentFromMembers(investmentId, amount) {
  const InvestmentContribution = require('../models/InvestmentContribution');
  const normalizedAmount = Number((Number(amount) || 0).toFixed(2));
  if (!(normalizedAmount > 0)) {
    const error = new Error('Investment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const members = await User.find({ role: 'member', status: 'active' }).sort({ createdAt: 1 });
  if (!members.length) {
    const error = new Error('No active members available to fund this investment.');
    error.status = 400;
    throw error;
  }

  const equalShares = splitAmountEqually(normalizedAmount, members.length);
  const contributions = [];
  let collected = 0;
  let unpaidTotal = 0;

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const expected = equalShares[index];
    let remaining = expected;
    let paidFromSavings = 0;
    let paidFromAdvance = 0;

    const savingsAvail = Math.max(0, Number(member.savings || 0));
    const fromSavings = Math.min(savingsAvail, remaining);
    if (fromSavings > 0) {
      member.savings = Number((savingsAvail - fromSavings).toFixed(2));
      paidFromSavings = fromSavings;
      remaining = Number((remaining - fromSavings).toFixed(2));
    }

    const advanceAvail = Math.max(0, Number(member.advanceBalance || 0));
    const fromAdvance = Math.min(advanceAvail, remaining);
    if (fromAdvance > 0) {
      member.advanceBalance = Number((advanceAvail - fromAdvance).toFixed(2));
      paidFromAdvance = fromAdvance;
      remaining = Number((remaining - fromAdvance).toFixed(2));
    }

    await member.save();

    const unpaidAmount = Math.max(0, remaining);
    const status = unpaidAmount > 0.001 ? 'unpaid' : 'paid';
    collected = Number((collected + paidFromSavings + paidFromAdvance).toFixed(2));
    unpaidTotal = Number((unpaidTotal + unpaidAmount).toFixed(2));

    const contribution = await InvestmentContribution.findOneAndUpdate(
      { investment: investmentId, member: member._id },
      {
        investment: investmentId,
        member: member._id,
        memberName: member.name,
        expectedAmount: expected,
        paidFromSavings,
        paidFromAdvance,
        borrowedAmount: 0,
        unpaidAmount,
        status,
        borrowing: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    contributions.push(contribution);
  }

  return {
    deductedAmount: collected,
    unpaidTotal,
    memberCount: members.length,
    paidCount: contributions.filter((c) => c.status === 'paid').length,
    unpaidCount: contributions.filter((c) => c.status === 'unpaid').length,
    contributions,
  };
}

const SOCIETY_INVESTMENT_FILTER = { member: null };

async function enrichInvestmentsWithSaleData(investments, { syncSaleStatus = false } = {}) {
  if (!investments.length) {
    return {
      active: [],
      sold: [],
      pendingMemberApproval: [],
      pendingCashierPayment: [],
      pending: [],
      all: [],
    };
  }

  const ids = investments.map((investment) => investment._id);
  const profitRecords = await InvestmentProfit.find({ investment: { $in: ids } })
    .sort({ createdAt: -1 })
    .lean();

  const latestByInvestment = new Map();
  for (const record of profitRecords) {
    const key = String(record.investment);
    if (!latestByInvestment.has(key)) {
      latestByInvestment.set(key, record);
    }
  }

  const enriched = [];
  const statusSyncOps = [];

  for (const investment of investments) {
    const plain = investment.toObject ? investment.toObject() : { ...investment };
    const record = latestByInvestment.get(String(plain._id));
    const workflowPending = ['pending_member_approval', 'pending_cashier_payment', 'rejected'].includes(plain.status);

    if (workflowPending) {
      enriched.push({
        ...plain,
        status: plain.status,
        saleAmount: 0,
        outcomeType: '',
        soldAt: null,
        netProfitLoss: 0,
        displayStatus: getInvestmentDisplayStatus(plain.status),
      });
      continue;
    }

    const isSold = plain.status === 'sold' || plain.status === 'closed' || Boolean(record);

    if (isSold) {
      const outcomeType = plain.outcomeType || record?.outcomeType || 'profit';
      const profitAmount = Number(record?.profitAmount || Math.abs(Number(plain.profit || 0)));
      const saleAmount = Number(plain.saleAmount || record?.saleAmount || 0);
      const soldAt = plain.soldAt || record?.createdAt || null;

      if (syncSaleStatus && plain.status !== 'sold' && record) {
        statusSyncOps.push({
          updateOne: {
            filter: { _id: plain._id },
            update: {
              $set: {
                status: 'sold',
                saleAmount,
                outcomeType,
                soldAt,
              },
            },
          },
        });
      }

      enriched.push({
        ...plain,
        status: plain.status === 'closed' ? 'closed' : 'sold',
        saleAmount,
        outcomeType,
        soldAt,
        netProfitLoss: outcomeType === 'loss' ? -profitAmount : profitAmount,
        displayStatus: plain.status === 'closed' ? 'Closed' : 'Sold',
      });
      continue;
    }

    enriched.push({
      ...plain,
      status: 'active',
      saleAmount: 0,
      outcomeType: '',
      soldAt: null,
      netProfitLoss: 0,
      displayStatus: 'Successful',
    });
  }

  if (statusSyncOps.length) {
    await Investment.bulkWrite(statusSyncOps, { ordered: false }).catch(() => {});
  }

  return {
    active: enriched.filter((item) => item.status === 'active'),
    sold: enriched.filter((item) => item.status === 'sold' || item.status === 'closed'),
    pendingMemberApproval: enriched.filter((item) => item.status === 'pending_member_approval'),
    pendingCashierPayment: enriched.filter((item) => item.status === 'pending_cashier_payment'),
    pending: enriched.filter((item) => (
      item.status === 'pending_member_approval' || item.status === 'pending_cashier_payment'
    )),
    all: enriched,
  };
}

function getInvestmentDisplayStatus(status) {
  switch (status) {
    case 'pending_member_approval':
      return 'Pending Member Approval';
    case 'pending_cashier_payment':
      return 'Pending Cashier Payment';
    case 'active':
      return 'Successful';
    case 'sold':
      return 'Sold';
    case 'closed':
      return 'Closed';
    case 'rejected':
      return 'Rejected';
    default:
      return status || 'Unknown';
  }
}

async function getGroupedSocietyInvestments({ syncSaleStatus = false } = {}) {
  const investments = await Investment.find(SOCIETY_INVESTMENT_FILTER)
    .populate('investor', 'name email role phone address dateOfBirth')
    .populate('projectManager', 'name email role')
    .sort({ createdAt: -1 });

  const missingCodes = investments.filter((investment) => !investment.investmentCode);
  if (missingCodes.length) {
    await Promise.all(missingCodes.map((investment) => ensureInvestmentCode(investment)));
  }

  return enrichInvestmentsWithSaleData(investments, { syncSaleStatus });
}

async function getAllInvestments() {
  const grouped = await getGroupedSocietyInvestments();
  return grouped.all;
}

async function getMemberInvestments(memberId) {
  return Investment.find({ member: memberId }).sort({ createdAt: -1 });
}

async function generateInvestmentCode() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const latest = await Investment.findOne({
    investmentCode: { $regex: `^${prefix}` },
  }).sort({ investmentCode: -1 });

  let sequence = 1;
  if (latest?.investmentCode) {
    const parts = latest.investmentCode.split('-');
    sequence = Number(parts[2] || 0) + 1;
  }

  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

async function ensureInvestmentCode(investment) {
  if (investment.investmentCode) {
    return investment;
  }

  const investmentCode = await generateInvestmentCode();
  await Investment.updateOne(
    { _id: investment._id },
    { $set: { investmentCode } }
  );
  investment.investmentCode = investmentCode;
  return investment;
}

async function getInvestmentByCode(code) {
  const normalizedCode = code?.trim();
  if (!normalizedCode) {
    const error = new Error('Investment ID is required.');
    error.status = 400;
    throw error;
  }

  let investment = await Investment.findOne({
    $or: [
      { investmentCode: normalizedCode },
      { investmentCode: normalizedCode.toUpperCase() },
    ],
  });

  if (!investment && normalizedCode.match(/^[a-f\d]{24}$/i)) {
    investment = await Investment.findById(normalizedCode);
  }

  if (!investment) {
    const error = new Error('Investment not found for this ID.');
    error.status = 404;
    throw error;
  }

  return ensureInvestmentCode(investment);
}

async function listInvestorUsers() {
  return User.find({
    role: 'investor',
    status: { $ne: 'deleted' },
  })
    .select('name email phone address dateOfBirth status createdAt')
    .sort({ name: 1 })
    .lean();
}

async function listProjectManagers() {
  return User.find({
    role: 'project_manager',
    status: { $ne: 'deleted' },
  })
    .select('name email phone status createdAt address')
    .sort({ name: 1 })
    .lean();
}

async function getProjectManagerPortfolio(managerId) {
  if (!managerId) {
    const error = new Error('Project manager ID is required.');
    error.status = 400;
    throw error;
  }

  const manager = await User.findOne({
    _id: managerId,
    role: 'project_manager',
    status: { $ne: 'deleted' },
  }).select('name email phone address status permissions createdAt');

  if (!manager) {
    const error = new Error('Project manager not found.');
    error.status = 404;
    throw error;
  }

  const investments = await Investment.find({
    member: null,
    projectManager: manager._id,
  })
    .populate('investor', 'name email')
    .sort({ createdAt: -1 });

  for (const investment of investments) {
    await ensureInvestmentCode(investment);
  }

  const grouped = await enrichInvestmentsWithSaleData(investments);
  const profitReturns = grouped.sold.reduce((sum, item) => {
    const value = Number(item.netProfitLoss || 0);
    return sum + (value > 0 ? value : 0);
  }, 0);
  const lossesManaged = grouped.sold.reduce((sum, item) => {
    const value = Number(item.netProfitLoss || 0);
    return sum + (value < 0 ? Math.abs(value) : 0);
  }, 0);
  const capitalDeployed = grouped.all
    .filter((item) => ['active', 'sold', 'pending_member_approval', 'pending_cashier_payment'].includes(item.status))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const activeCapital = grouped.active.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expensesManaged = grouped.all.reduce((sum, item) => sum + Number(item.withdrawals || 0), 0) + lossesManaged;

  const projectsByType = new Map();
  for (const item of grouped.all) {
    const typeKey = item.investmentType || 'Other';
    if (!projectsByType.has(typeKey)) {
      projectsByType.set(typeKey, {
        investmentType: typeKey,
        count: 0,
        totalAmount: 0,
        investments: [],
      });
    }
    const bucket = projectsByType.get(typeKey);
    bucket.count += 1;
    bucket.totalAmount += Number(item.amount || 0);
    bucket.investments.push(item);
  }

  return {
    manager,
    summary: {
      assignedProjects: grouped.all.length,
      activeProjects: grouped.active.length,
      soldProjects: grouped.sold.length,
      pendingProjects: grouped.pending.length,
      capitalDeployed: Number(capitalDeployed.toFixed(2)),
      activeCapital: Number(activeCapital.toFixed(2)),
      profitReturns: Number(profitReturns.toFixed(2)),
      expensesManaged: Number(expensesManaged.toFixed(2)),
      lossesManaged: Number(lossesManaged.toFixed(2)),
    },
    projectsByType: [...projectsByType.values()].map((bucket) => ({
      ...bucket,
      totalAmount: Number(bucket.totalAmount.toFixed(2)),
    })),
    investments: grouped.all,
    activeInvestments: grouped.active,
    soldInvestments: grouped.sold,
    pendingInvestments: grouped.pending,
  };
}

async function createSocietyInvestment({
  amount,
  investorId,
  investmentType,
  projectManagerId,
  investorName,
  dateOfBirth,
  location,
  sector,
  partner,
  notes = '',
  documents = [],
  createdBy = 'Admin',
  returnMode = 'fixed_term',
  termMonths = null,
  maturityDate = null,
  societyOwnershipPct = null,
  investorOwnershipPct = null,
  societyAmount = null,
  externalAmount = null,
}) {
  let investorUser = null;
  if (investorId) {
    investorUser = await User.findOne({
      _id: investorId,
      role: 'investor',
      status: { $ne: 'deleted' },
    });
    if (!investorUser) {
      const error = new Error('Selected investor was not found. Create the investor from the CEO Panel first.');
      error.status = 404;
      throw error;
    }
  }

  let projectManagerUser = null;
  if (projectManagerId) {
    projectManagerUser = await User.findOne({
      _id: projectManagerId,
      role: 'project_manager',
      status: { $ne: 'deleted' },
    });
    if (!projectManagerUser) {
      const error = new Error('Selected project manager was not found.');
      error.status = 404;
      throw error;
    }
  }

  const normalizedType = investmentType?.trim() || 'Fixed Investment';
  const normalizedName = investorUser?.name
    || investorName?.trim()
    || partner?.trim();
  const normalizedLocation = location?.trim()
    || investorUser?.address?.trim()
    || 'Not specified';
  const normalizedSector = sector?.trim() || normalizedType || normalizedLocation || 'General';
  const normalizedPartner = partner?.trim() || normalizedName || 'Investor';

  if (!normalizedName) {
    const error = new Error('Select an investor or provide an investor name.');
    error.status = 400;
    throw error;
  }

  if (!amount || Number(amount) <= 0) {
    const error = new Error('Investment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const { normalizeOwnership } = require('./projectFinanceService');
  const ownership = normalizeOwnership({
    amount,
    societyOwnershipPct,
    investorOwnershipPct,
    societyAmount,
    externalAmount,
  });

  if (ownership.investorOwnershipPct > 0 && !investorId && !investorName?.trim() && !partner?.trim()) {
    const error = new Error('An external investor is required when investor ownership is greater than 0%.');
    error.status = 400;
    throw error;
  }

  const normalizedReturnMode = returnMode === 'monthly' ? 'monthly' : 'fixed_term';
  let parsedMaturity = maturityDate ? new Date(maturityDate) : null;
  const normalizedTermMonths = termMonths ? Number(termMonths) : null;
  if (normalizedReturnMode === 'fixed_term' && normalizedTermMonths > 0 && !parsedMaturity) {
    parsedMaturity = new Date();
    parsedMaturity.setMonth(parsedMaturity.getMonth() + normalizedTermMonths);
  }

  const eligibleMembers = await User.find({
    role: 'member',
    status: 'active',
  }).select('_id name email');

  if (!eligibleMembers.length) {
    const error = new Error('No active members available to approve this investment.');
    error.status = 400;
    throw error;
  }

  const investmentCode = await generateInvestmentCode();
  const parsedDateOfBirth = dateOfBirth
    ? new Date(dateOfBirth)
    : (investorUser?.dateOfBirth ? new Date(investorUser.dateOfBirth) : null);

  const investment = await Investment.create({
    investmentCode,
    investmentType: normalizedType,
    investor: investorUser?._id || null,
    projectManager: projectManagerUser?._id || null,
    investorName: normalizedName,
    dateOfBirth: parsedDateOfBirth && !Number.isNaN(parsedDateOfBirth.getTime()) ? parsedDateOfBirth : null,
    location: normalizedLocation,
    amount: ownership.amount,
    returnMode: normalizedReturnMode,
    termMonths: normalizedTermMonths > 0 ? normalizedTermMonths : null,
    maturityDate: parsedMaturity && !Number.isNaN(parsedMaturity.getTime()) ? parsedMaturity : null,
    societyOwnershipPct: ownership.societyOwnershipPct,
    investorOwnershipPct: ownership.investorOwnershipPct,
    societyAmount: ownership.societyAmount,
    externalAmount: ownership.externalAmount,
    sector: normalizedSector,
    partner: normalizedPartner,
    allocation: normalizedSector,
    notes: notes?.trim() || '',
    documents: Array.isArray(documents) ? documents : [],
    eligibleMembers: eligibleMembers.map((member) => member._id),
    approvals: [],
    status: 'pending_member_approval',
    createdBy: createdBy?.trim() || 'Admin',
    member: null,
  });

  await investment.populate([
    { path: 'investor', select: 'name email role phone address dateOfBirth' },
    { path: 'projectManager', select: 'name email role' },
  ]);

  const notifyTitle = `New investment request ${investment.investmentCode}`;
  const notifyMessage = `${normalizedName} · ${normalizedType} · ${formatMoney(ownership.amount, 2)} · Society ${ownership.societyOwnershipPct}% / Investor ${ownership.investorOwnershipPct}% (${normalizedReturnMode === 'monthly' ? 'Monthly return' : 'Fixed/term'}). Please review and approve.`;

  await Promise.all(eligibleMembers.map((member) => createMemberNotification({
    memberId: member._id,
    type: 'general',
    title: notifyTitle,
    message: notifyMessage,
    relatedId: investment._id,
    relatedModel: 'Investment',
  })));

  await createAdminNotification({
    type: 'general',
    title: `Investment proposed: ${investment.investmentCode}`,
    message: `Awaiting approval from ${eligibleMembers.length} members.`,
    relatedId: investment._id,
    relatedModel: 'Investment',
  });

  return {
    investment,
    approvalTracking: await buildApprovalTracking(investment),
    savingsUpdate: null,
    message: 'Investment submitted for member approval. Funds will be deducted after cashier payment.',
  };
}

async function buildApprovalTracking(investment, memberByIdCache = null) {
  const eligibleIds = (investment.eligibleMembers || []).map((id) => String(id?._id || id));
  const approvedIds = new Set((investment.approvals || []).map((item) => String(item.member)));

  let memberById = memberByIdCache;
  if (!memberById) {
    const members = await User.find({ _id: { $in: investment.eligibleMembers || [] } })
      .select('name email status')
      .lean();
    memberById = new Map(members.map((member) => [String(member._id), member]));
  }

  const approvedMembers = [];
  const pendingMembers = [];

  for (const id of eligibleIds) {
    const member = memberById.get(id);
    const approval = (investment.approvals || []).find((item) => String(item.member) === id);
    const row = {
      id,
      name: approval?.memberName || member?.name || 'Member',
      email: member?.email || '',
      approvedAt: approval?.approvedAt || null,
      isProxied: Boolean(approval?.proxiedBy),
      proxiedByName: approval?.proxiedByName || '',
      proxyReason: approval?.proxyReason || '',
    };
    if (approvedIds.has(id)) approvedMembers.push(row);
    else pendingMembers.push(row);
  }

  return {
    totalMembers: eligibleIds.length,
    approvedCount: approvedMembers.length,
    pendingCount: pendingMembers.length,
    allApproved: eligibleIds.length > 0 && approvedMembers.length >= eligibleIds.length,
    approvedMembers,
    pendingMembers,
    displayStatus: getInvestmentDisplayStatus(investment.status),
  };
}

async function buildApprovalTrackingBatch(investments = []) {
  const allEligibleIds = [];
  for (const investment of investments) {
    for (const id of investment.eligibleMembers || []) {
      allEligibleIds.push(id?._id || id);
    }
  }
  const uniqueIds = [...new Set(allEligibleIds.map((id) => String(id)))];
  const members = uniqueIds.length
    ? await User.find({ _id: { $in: uniqueIds } }).select('name email status').lean()
    : [];
  const memberById = new Map(members.map((member) => [String(member._id), member]));

  const rows = [];
  for (const item of investments) {
    rows.push({
      ...item,
      approvalTracking: await buildApprovalTracking(item, memberById),
    });
  }
  return rows;
}

async function getInvestmentApprovalDetails(investmentId) {
  const investment = await Investment.findById(investmentId)
    .populate('investor', 'name email role')
    .populate('projectManager', 'name email role')
    .populate('eligibleMembers', 'name email status');

  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }

  return {
    investment,
    approvalTracking: await buildApprovalTracking(investment),
  };
}

async function listPendingMemberInvestmentRequests(memberId) {
  const investments = await Investment.find({
    member: null,
    status: 'pending_member_approval',
    eligibleMembers: memberId,
  })
    .populate('investor', 'name email')
    .populate('projectManager', 'name email')
    .sort({ createdAt: -1 });

  return investments.map((investment) => {
    const plain = investment.toObject();
    const alreadyApproved = (plain.approvals || []).some((item) => String(item.member) === String(memberId));
    return {
      ...plain,
      alreadyApproved,
      displayStatus: getInvestmentDisplayStatus(plain.status),
      approvalCount: (plain.approvals || []).length,
      requiredApprovals: (plain.eligibleMembers || []).length,
    };
  });
}

async function approveInvestmentByMember(investmentId, memberId, { proxy = null } = {}) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: 'active',
  }).select('name email');

  if (!member) {
    const error = new Error('Only active members can approve investments.');
    error.status = 403;
    throw error;
  }

  const investment = await Investment.findById(investmentId);
  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }

  if (investment.status !== 'pending_member_approval') {
    const error = new Error('This investment is not awaiting member approval.');
    error.status = 400;
    throw error;
  }

  const eligible = (investment.eligibleMembers || []).some((id) => String(id) === String(memberId));
  if (!eligible) {
    const error = new Error('You are not eligible to approve this investment.');
    error.status = 403;
    throw error;
  }

  const alreadyApproved = (investment.approvals || []).some((item) => String(item.member) === String(memberId));
  if (alreadyApproved) {
    return {
      investment,
      approvalTracking: await buildApprovalTracking(investment),
      message: 'You already approved this investment.',
    };
  }

  investment.approvals.push({
    member: member._id,
    memberName: member.name,
    approvedAt: new Date(),
    ...(proxy ? {
      proxiedBy: proxy.proxiedBy,
      proxiedByName: proxy.proxiedByName,
      proxiedByRole: proxy.proxiedByRole,
      proxyReason: proxy.proxyReason,
    } : {}),
  });

  const trackingBeforeSave = await buildApprovalTracking(investment);
  if (trackingBeforeSave.allApproved) {
    investment.status = 'pending_cashier_payment';
    await createAdminNotification({
      type: 'general',
      title: `Investment ready for cashier: ${investment.investmentCode}`,
      message: `All ${trackingBeforeSave.totalMembers} members approved. Awaiting cashier payment.`,
      relatedId: investment._id,
      relatedModel: 'Investment',
    });
  }

  await investment.save();

  return {
    investment,
    approvalTracking: await buildApprovalTracking(investment),
    message: trackingBeforeSave.allApproved
      ? 'Approved. Investment moved to cashier payment queue.'
      : 'Approval recorded successfully.',
  };
}

async function listCashierPaymentQueue() {
  const investments = await Investment.find({
    member: null,
    status: 'pending_cashier_payment',
  })
    .populate('investor', 'name email role bankAccountName bankAccountNumber bankName phone')
    .populate('projectManager', 'name email role bankAccountName bankAccountNumber bankName phone')
    .populate('member', 'name email role bankAccountName bankAccountNumber bankName phone')
    .sort({ createdAt: -1 });

  const rows = [];
  for (const investment of investments) {
    const receiver = resolvePayoutReceiver(investment);
    rows.push({
      ...investment.toObject(),
      displayStatus: getInvestmentDisplayStatus(investment.status),
      approvalTracking: await buildApprovalTracking(investment),
      payoutReceiver: receiver,
    });
  }
  return rows;
}

function resolvePayoutReceiver(investment, overrides = {}) {
  const linked = investment.investor || investment.projectManager || investment.member || null;
  const role = overrides.payoutReceiverRole
    || linked?.role
    || (investment.investor ? 'investor' : investment.projectManager ? 'project_manager' : investment.member ? 'member' : 'payee');

  return {
    role,
    name: overrides.payoutReceiverName || linked?.name || investment.investorName || 'Unknown payee',
    email: overrides.payoutReceiverEmail || linked?.email || '',
    phone: linked?.phone || '',
    accountName: overrides.payoutAccountName || linked?.bankAccountName || linked?.name || investment.investorName || '',
    accountNumber: overrides.payoutAccountNumber || linked?.bankAccountNumber || '',
    bankName: overrides.payoutBankName || linked?.bankName || '',
  };
}

/**
 * Dry-run: can each active member cover their equal project share from
 * savings + advance, and are current-month contribution dues settled?
 */
async function previewMemberShareFunding(requiredAmount) {
  const normalizedAmount = Number((Number(requiredAmount) || 0).toFixed(2));
  const members = await User.find({ role: 'member', status: 'active' }).sort({ createdAt: 1 });
  if (!members.length) {
    return {
      yearMonth: null,
      memberCount: 0,
      members: [],
      shortMembers: [],
      hasMemberShortfall: false,
      hasMonthlyGaps: false,
      hasMemberProblems: false,
      totalShareDeficit: 0,
      totalMonthlyUnpaid: 0,
    };
  }

  const equalShares = splitAmountEqually(normalizedAmount, members.length);
  const {
    yearMonthFromDate,
    listUnpaidMonthlyDues,
  } = require('./monthlyTargetService');
  const yearMonth = yearMonthFromDate();
  let unpaidDues = [];
  try {
    unpaidDues = await listUnpaidMonthlyDues({ yearMonth });
  } catch (_) {
    unpaidDues = [];
  }
  const unpaidByMember = new Map(
    unpaidDues.map((row) => [String(row.memberId?._id || row.memberId), row])
  );

  const rows = members.map((member, index) => {
    const expectedShare = equalShares[index];
    const savings = Number(Number(member.savings || 0).toFixed(2));
    const advanceBalance = Number(Number(member.advanceBalance || 0).toFixed(2));
    const available = Number((savings + advanceBalance).toFixed(2));
    const shareDeficit = Number(Math.max(0, expectedShare - available).toFixed(2));
    const monthly = unpaidByMember.get(String(member._id));
    const monthlyUnpaid = monthly ? Number(Number(monthly.unpaidAmount || 0).toFixed(2)) : 0;
    const needsCover = shareDeficit > 0.001 || monthlyUnpaid > 0.001;
    return {
      id: member._id,
      name: member.name || '',
      email: member.email || '',
      expectedShare,
      savings,
      advanceBalance,
      available,
      shareDeficit,
      monthlyUnpaid,
      monthlyStatus: monthly ? monthly.status : (monthlyUnpaid > 0 ? 'unpaid' : 'ok'),
      needsCover,
      coverSuggested: Number(Math.max(shareDeficit, monthlyUnpaid).toFixed(2)),
    };
  });

  const shortMembers = rows.filter((row) => row.needsCover);
  const totalShareDeficit = Number(
    shortMembers.reduce((sum, row) => sum + Number(row.shareDeficit || 0), 0).toFixed(2)
  );
  const totalMonthlyUnpaid = Number(
    shortMembers.reduce((sum, row) => sum + Number(row.monthlyUnpaid || 0), 0).toFixed(2)
  );

  return {
    yearMonth,
    memberCount: members.length,
    members: rows,
    shortMembers,
    hasMemberShortfall: totalShareDeficit > 0.001,
    hasMonthlyGaps: totalMonthlyUnpaid > 0.001,
    hasMemberProblems: shortMembers.length > 0,
    totalShareDeficit,
    totalMonthlyUnpaid,
  };
}

async function getCashierPaymentFundingSnapshot(investment) {
  const societyFundingAmount = Number(Number(
    investment.societyAmount > 0 ? investment.societyAmount : investment.amount
  ).toFixed(2));

  const [{ getLedger }, { ensureFund, money: reserveMoney }, { listMemberAdvanceBalances }] = await Promise.all([
    Promise.resolve(require('./bankLedgerService')),
    Promise.resolve(require('./emergencyReserveService')),
    Promise.resolve(require('./advanceBorrowingService')),
  ]);

  let bookBalance = 0;
  let openingSet = false;
  try {
    const ledger = await getLedger({ entryLimit: 1 });
    bookBalance = Number(Number(ledger.bookBalance || 0).toFixed(2));
    openingSet = Boolean(ledger.openingSet);
  } catch (_) {
    bookBalance = 0;
    openingSet = false;
  }

  const fund = await ensureFund();
  const reserveBalance = reserveMoney(fund.balance);
  const advances = (await listMemberAdvanceBalances())
    .filter((m) => Number(m.advanceBalance || 0) > 0.001)
    .sort((a, b) => Number(b.advanceBalance || 0) - Number(a.advanceBalance || 0));

  const shortfall = Number(Math.max(0, societyFundingAmount - bookBalance).toFixed(2));
  const totalAdvanceAvailable = Number(
    advances.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0).toFixed(2)
  );
  const memberFunding = await previewMemberShareFunding(societyFundingAmount);
  const bookReady = openingSet && shortfall <= 0.001;
  const canCompleteDirectly = bookReady && !memberFunding.hasMemberProblems;

  return {
    investmentId: investment._id,
    investmentCode: investment.investmentCode || '',
    status: investment.status,
    requiredAmount: societyFundingAmount,
    bookBalance,
    openingSet,
    shortfall,
    hasShortfall: shortfall > 0.001,
    canComplete: bookReady,
    canCompleteDirectly,
    needsPopup: !canCompleteDirectly,
    memberFunding,
    hasMemberProblems: memberFunding.hasMemberProblems,
    reserveBalance,
    totalAdvanceAvailable,
    advanceMembers: advances,
    coverOptions: {
      canUseReserve: reserveBalance > 0.001,
      canUseAdvance: totalAdvanceAvailable > 0.001,
      maxCoverable: Number(
        Math.min(
          Math.max(shortfall, memberFunding.totalShareDeficit, memberFunding.totalMonthlyUnpaid),
          reserveBalance + totalAdvanceAvailable
        ).toFixed(2)
      ),
    },
  };
}

/**
 * Pre-flight check before Complete Payment — used by the shortfall modal.
 */
async function previewCashierPayment(investmentId) {
  const investment = await Investment.findById(investmentId)
    .populate('investor', 'name email role')
    .populate('projectManager', 'name email role')
    .populate('member', 'name email role');

  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }
  if (investment.status !== 'pending_cashier_payment') {
    const error = new Error('Investment is not awaiting cashier payment.');
    error.status = 400;
    throw error;
  }

  const funding = await getCashierPaymentFundingSnapshot(investment);
  const receiver = resolvePayoutReceiver(investment);
  const shortNames = (funding.memberFunding?.shortMembers || [])
    .map((row) => row.name || 'Member')
    .slice(0, 5);
  const shortLabel = shortNames.length
    ? `${shortNames.join(', ')}${(funding.memberFunding.shortMembers.length > 5) ? '…' : ''}`
    : '';

  let message;
  if (funding.canCompleteDirectly) {
    message = `All member accounts are balanced and book balance covers ${formatMoney(funding.requiredAmount, 2)}. Payment can complete directly.`;
  } else if (!funding.openingSet) {
    message = 'Bank ledger opening balance is not set. Set it before completing payment.';
  } else if (funding.hasMemberProblems) {
    message = `Member account gap(s) for ${shortLabel || 'one or more members'}. Cover from another member's advance or Emergency / Reserve Fund, then complete payment.`;
  } else if (funding.hasShortfall) {
    message = `Book balance shortfall of ${formatMoney(funding.shortfall, 2)}. Cover it from member advance (internal borrow) or Emergency / Reserve Fund before completing payment.`;
  } else {
    message = 'Resolve funding issues before completing payment.';
  }

  return {
    ...funding,
    payoutReceiver: receiver,
    investment: {
      _id: investment._id,
      investmentCode: investment.investmentCode,
      investmentType: investment.investmentType,
      amount: investment.amount,
      societyAmount: investment.societyAmount,
      externalAmount: investment.externalAmount,
      status: investment.status,
    },
    message,
  };
}

/**
 * Cover book-balance shortfall OR a specific member's pre-payment deficit
 * by using another member's advance.
 *
 * - With borrowerId: debit lender advance → credit borrower savings (and apply
 *   toward current-month contribution due when applicable).
 * - Without borrowerId: release advance into the society book (existing path).
 */
async function coverCashierPaymentShortfallFromAdvance({
  investmentId,
  lenderId,
  amount,
  borrowerId = null,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  const investment = await Investment.findById(investmentId);
  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }
  if (investment.status !== 'pending_cashier_payment') {
    const error = new Error('Investment is not awaiting cashier payment.');
    error.status = 400;
    throw error;
  }

  const snapshot = await getCashierPaymentFundingSnapshot(investment);
  if (!snapshot.openingSet) {
    const error = new Error('Set the bank ledger opening balance before covering a payment shortfall.');
    error.status = 409;
    error.funding = snapshot;
    throw error;
  }

  // --- Member deficit cover (credit borrower savings) ---
  if (borrowerId) {
    if (String(borrowerId) === String(lenderId)) {
      const error = new Error('Lender and short member must be different people.');
      error.status = 400;
      throw error;
    }

    const shortRow = (snapshot.memberFunding?.shortMembers || [])
      .find((row) => String(row.id) === String(borrowerId));
    if (!shortRow || !shortRow.needsCover) {
      const error = new Error('Selected member does not currently have a payment deficit to cover.');
      error.status = 400;
      error.funding = snapshot;
      throw error;
    }

    const maxCover = Number(shortRow.coverSuggested || 0);
    const payAmount = amount == null || amount === ''
      ? maxCover
      : Number(Number(amount).toFixed(2));
    if (!(payAmount > 0)) {
      const error = new Error('Cover amount must be greater than zero.');
      error.status = 400;
      throw error;
    }
    if (payAmount > maxCover + 0.001) {
      const error = new Error(
        `Cover amount exceeds ${shortRow.name}'s gap of ${formatMoney(maxCover, 2)}.`
      );
      error.status = 400;
      throw error;
    }

    const [lender, borrower] = await Promise.all([
      User.findOne({ _id: lenderId, role: 'member', status: 'active' }),
      User.findOne({ _id: borrowerId, role: 'member', status: 'active' }),
    ]);
    if (!lender) {
      const error = new Error('Lender member not found or inactive.');
      error.status = 404;
      throw error;
    }
    if (!borrower) {
      const error = new Error('Short member not found or inactive.');
      error.status = 404;
      throw error;
    }
    const advanceAvail = Number(Number(lender.advanceBalance || 0).toFixed(2));
    if (payAmount > advanceAvail + 0.001) {
      const error = new Error(
        `Lender advance balance insufficient. Available: ${formatMoney(advanceAvail, 2)}.`
      );
      error.status = 400;
      throw error;
    }

    lender.advanceBalance = Number((advanceAvail - payAmount).toFixed(2));
    borrower.savings = Number((Number(borrower.savings || 0) + payAmount).toFixed(2));
    await Promise.all([lender.save(), borrower.save()]);

    const InternalBorrowing = require('../models/InternalBorrowing');
    const borrowing = await InternalBorrowing.create({
      investment: investment._id,
      contribution: null,
      lender: lender._id,
      lenderName: lender.name,
      borrower: borrower._id,
      borrowerName: borrower.name,
      amount: payAmount,
      amountSettled: 0,
      status: 'open',
      note: note?.trim()
        || `Pre-payment cover for ${borrower.name} from ${lender.name} advance · ${investment.investmentCode || 'project'}`,
      createdBy: String(createdBy || 'Cashier').trim(),
    });

    try {
      const { applyDepositToMonthlyDue } = require('./monthlyTargetService');
      await applyDepositToMonthlyDue({ member: borrower, amount: payAmount });
    } catch (_) {
      // Monthly due update is best-effort; savings credit already applied.
    }

    const funding = await getCashierPaymentFundingSnapshot(investment);
    return {
      mode: 'member',
      borrowing,
      coveredAmount: payAmount,
      amountCovered: payAmount,
      borrower: { id: borrower._id, name: borrower.name, savings: borrower.savings },
      lender: { id: lender._id, name: lender.name, advanceBalance: lender.advanceBalance },
      funding,
      message: `Covered ${formatMoney(payAmount, 2)} for ${borrower.name} from ${lender.name}'s advance.`,
    };
  }

  // --- Book balance cover (existing behaviour) ---
  if (!(snapshot.shortfall > 0.001)) {
    const error = new Error('There is no book-balance shortfall to cover. Select a short member if covering a member gap.');
    error.status = 400;
    error.funding = snapshot;
    throw error;
  }

  const payAmount = amount == null || amount === ''
    ? snapshot.shortfall
    : Number(Number(amount).toFixed(2));
  if (!(payAmount > 0)) {
    const error = new Error('Cover amount must be greater than zero.');
    error.status = 400;
    throw error;
  }
  if (payAmount > snapshot.shortfall + 0.001) {
    const error = new Error(
      `Cover amount exceeds shortfall of ${formatMoney(snapshot.shortfall, 2)}.`
    );
    error.status = 400;
    throw error;
  }

  const lender = await User.findOne({ _id: lenderId, role: 'member', status: 'active' });
  if (!lender) {
    const error = new Error('Lender member not found or inactive.');
    error.status = 404;
    throw error;
  }
  const advanceAvail = Number(Number(lender.advanceBalance || 0).toFixed(2));
  if (payAmount > advanceAvail + 0.001) {
    const error = new Error(
      `Lender advance balance insufficient. Available: ${formatMoney(advanceAvail, 2)}.`
    );
    error.status = 400;
    throw error;
  }

  const borrower = await User.findOne({
    role: 'member',
    status: 'active',
    _id: { $ne: lender._id },
  }).sort({ createdAt: 1 }) || lender;

  lender.advanceBalance = Number((advanceAvail - payAmount).toFixed(2));
  await lender.save();

  const InternalBorrowing = require('../models/InternalBorrowing');
  const borrowing = await InternalBorrowing.create({
    investment: investment._id,
    contribution: null,
    lender: lender._id,
    lenderName: lender.name,
    borrower: borrower._id,
    borrowerName: borrower._id.equals(lender._id)
      ? 'Society (project funding)'
      : `${borrower.name} / Society project funding`,
    amount: payAmount,
    amountSettled: 0,
    status: 'open',
    note: note?.trim()
      || `Internal borrow from ${lender.name} advance to cover book shortfall for ${investment.investmentCode || 'project'}`,
    createdBy: String(createdBy || 'Cashier').trim(),
  });

  const { creditInbound } = require('./bankLedgerService');
  const bankLedger = await creditInbound({
    type: 'deposit',
    amount: payAmount,
    referenceType: 'InternalBorrowing',
    referenceId: borrowing._id,
    note: `Advance released to book for project payment shortfall · ${investment.investmentCode || ''} · lender ${lender.name}`,
    createdBy,
    paymentChannel: 'cash',
  });

  const funding = await getCashierPaymentFundingSnapshot(investment);
  return {
    mode: 'book',
    borrowing,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? funding.bookBalance,
    amountCovered: payAmount,
    funding,
    message: `Covered ${formatMoney(payAmount, 2)} from ${lender.name}'s advance. Book balance now ${formatMoney(funding.bookBalance, 2)}. Shortfall remaining: ${formatMoney(funding.shortfall, 2)}.`,
  };
}

/**
 * Cover book-balance shortfall OR a specific member's pre-payment deficit
 * from the Emergency / Reserve Fund.
 *
 * - With memberId: debit reserve → credit that member's savings.
 * - Without memberId: release reserve into the society book (existing path).
 */
async function coverCashierPaymentShortfallFromReserve({
  investmentId,
  amount,
  memberId = null,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  const investment = await Investment.findById(investmentId);
  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }
  if (investment.status !== 'pending_cashier_payment') {
    const error = new Error('Investment is not awaiting cashier payment.');
    error.status = 400;
    throw error;
  }

  const snapshot = await getCashierPaymentFundingSnapshot(investment);
  if (!snapshot.openingSet) {
    const error = new Error('Set the bank ledger opening balance before covering a payment shortfall.');
    error.status = 409;
    error.funding = snapshot;
    throw error;
  }

  const { debitReserve } = require('./emergencyReserveService');

  if (memberId) {
    const shortRow = (snapshot.memberFunding?.shortMembers || [])
      .find((row) => String(row.id) === String(memberId));
    if (!shortRow || !shortRow.needsCover) {
      const error = new Error('Selected member does not currently have a payment deficit to cover.');
      error.status = 400;
      error.funding = snapshot;
      throw error;
    }

    const maxCover = Number(shortRow.coverSuggested || 0);
    const payAmount = amount == null || amount === ''
      ? Math.min(maxCover, snapshot.reserveBalance)
      : Number(Number(amount).toFixed(2));
    if (!(payAmount > 0)) {
      const error = new Error('Cover amount must be greater than zero.');
      error.status = 400;
      throw error;
    }
    if (payAmount > maxCover + 0.001) {
      const error = new Error(
        `Cover amount exceeds ${shortRow.name}'s gap of ${formatMoney(maxCover, 2)}.`
      );
      error.status = 400;
      throw error;
    }
    if (payAmount > snapshot.reserveBalance + 0.001) {
      const error = new Error(
        `Emergency reserve has only ${formatMoney(snapshot.reserveBalance, 2)} available.`
      );
      error.status = 400;
      throw error;
    }

    const member = await User.findOne({ _id: memberId, role: 'member', status: 'active' });
    if (!member) {
      const error = new Error('Short member not found or inactive.');
      error.status = 404;
      throw error;
    }

    const reserveResult = await debitReserve(payAmount, {
      type: 'project_cover',
      note: note?.trim()
        || `Pre-payment cover for ${member.name} from Emergency/Reserve · ${investment.investmentCode || ''}`,
      createdBy,
      referenceType: 'Investment',
      referenceId: investment._id,
    });

    member.savings = Number((Number(member.savings || 0) + payAmount).toFixed(2));
    await member.save();

    try {
      const { applyDepositToMonthlyDue } = require('./monthlyTargetService');
      await applyDepositToMonthlyDue({ member, amount: payAmount });
    } catch (_) {
      // best-effort
    }

    const funding = await getCashierPaymentFundingSnapshot(investment);
    return {
      mode: 'member',
      reserve: {
        balance: reserveResult.balance,
        entry: reserveResult.entry,
      },
      coveredAmount: payAmount,
      amountCovered: payAmount,
      member: { id: member._id, name: member.name, savings: member.savings },
      funding,
      message: `Covered ${formatMoney(payAmount, 2)} for ${member.name} from Emergency / Reserve Fund.`,
    };
  }

  if (!(snapshot.shortfall > 0.001)) {
    const error = new Error('There is no book-balance shortfall to cover. Select a short member if covering a member gap.');
    error.status = 400;
    error.funding = snapshot;
    throw error;
  }

  const payAmount = amount == null || amount === ''
    ? Math.min(snapshot.shortfall, snapshot.reserveBalance)
    : Number(Number(amount).toFixed(2));
  if (!(payAmount > 0)) {
    const error = new Error('Cover amount must be greater than zero.');
    error.status = 400;
    throw error;
  }
  if (payAmount > snapshot.shortfall + 0.001) {
    const error = new Error(
      `Cover amount exceeds shortfall of ${formatMoney(snapshot.shortfall, 2)}.`
    );
    error.status = 400;
    throw error;
  }
  if (payAmount > snapshot.reserveBalance + 0.001) {
    const error = new Error(
      `Emergency reserve has only ${formatMoney(snapshot.reserveBalance, 2)} available.`
    );
    error.status = 400;
    throw error;
  }

  const { creditInbound } = require('./bankLedgerService');

  const reserveResult = await debitReserve(payAmount, {
    type: 'project_cover',
    note: note?.trim()
      || `Released to book for cashier payment shortfall · ${investment.investmentCode || ''}`,
    createdBy,
    referenceType: 'Investment',
    referenceId: investment._id,
  });

  const bankLedger = await creditInbound({
    type: 'reserve_disbursement',
    amount: payAmount,
    referenceType: 'EmergencyReserveFund',
    referenceId: reserveResult.fund?._id || null,
    note: `Emergency/Reserve → book for project payment · ${investment.investmentCode || ''}`,
    createdBy,
  });

  const funding = await getCashierPaymentFundingSnapshot(investment);
  return {
    mode: 'book',
    reserve: {
      balance: reserveResult.balance,
      entry: reserveResult.entry,
    },
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? funding.bookBalance,
    amountCovered: payAmount,
    funding,
    message: `Covered ${formatMoney(payAmount, 2)} from Emergency / Reserve Fund. Book balance now ${formatMoney(funding.bookBalance, 2)}. Shortfall remaining: ${formatMoney(funding.shortfall, 2)}.`,
  };
}

async function completeCashierPayment(investmentId, {
  cashierName = 'Cashier',
  note = '',
  payoutReceiverRole,
  payoutReceiverName,
  payoutReceiverEmail,
  payoutAccountName,
  payoutAccountNumber,
  payoutBankName,
} = {}) {
  const investment = await Investment.findById(investmentId)
    .populate('investor', 'name email role bankAccountName bankAccountNumber bankName phone')
    .populate('projectManager', 'name email role bankAccountName bankAccountNumber bankName phone')
    .populate('member', 'name email role bankAccountName bankAccountNumber bankName phone');

  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }

  if (investment.status !== 'pending_cashier_payment') {
    const error = new Error('Investment is not awaiting cashier payment.');
    error.status = 400;
    throw error;
  }

  const fundingCheck = await getCashierPaymentFundingSnapshot(investment);
  if (!fundingCheck.openingSet) {
    const error = new Error('Set the bank ledger opening balance before completing payment.');
    error.status = 409;
    error.code = 'OPENING_BALANCE_REQUIRED';
    error.funding = fundingCheck;
    throw error;
  }
  if (fundingCheck.hasShortfall) {
    const error = new Error(
      `Insufficient book balance for this project payment. Required ${formatMoney(fundingCheck.requiredAmount, 2)}; book ${formatMoney(fundingCheck.bookBalance, 2)}; shortfall ${formatMoney(fundingCheck.shortfall, 2)}. Cover from member advance or Emergency/Reserve Fund first.`
    );
    error.status = 409;
    error.code = 'INSUFFICIENT_BOOK_BALANCE';
    error.funding = fundingCheck;
    throw error;
  }
  if (fundingCheck.hasMemberProblems) {
    const names = (fundingCheck.memberFunding?.shortMembers || [])
      .map((row) => row.name)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    const error = new Error(
      `One or more members cannot cover their share yet${names ? ` (${names})` : ''}. Cover the gap from advance or Emergency/Reserve Fund first.`
    );
    error.status = 409;
    error.code = 'MEMBER_SHARE_SHORTFALL';
    error.funding = fundingCheck;
    throw error;
  }

  const receiver = resolvePayoutReceiver(investment, {
    payoutReceiverRole,
    payoutReceiverName,
    payoutReceiverEmail,
    payoutAccountName,
    payoutAccountNumber,
    payoutBankName,
  });

  const societyFundingAmount = fundingCheck.requiredAmount;

  const savingsUpdate = await fundInvestmentFromMembers(investment._id, societyFundingAmount);
  investment.status = 'active';
  investment.cashierNote = note?.trim() || '';
  investment.cashierProcessedBy = cashierName?.trim() || 'Cashier';
  investment.cashierProcessedAt = new Date();
  investment.payoutReceiverRole = receiver.role;
  investment.payoutReceiverName = receiver.name;
  investment.payoutReceiverEmail = receiver.email;
  investment.payoutAccountName = receiver.accountName;
  investment.payoutAccountNumber = receiver.accountNumber;
  investment.payoutBankName = receiver.bankName;

  let bankLedger = null;
  if (societyFundingAmount > 0) {
    const { debit } = require('./bankLedgerService');
    try {
      bankLedger = await debit({
        type: 'project_payout',
        amount: societyFundingAmount,
        referenceType: 'Investment',
        referenceId: investment._id,
        note: `Society project payout (${investment.societyOwnershipPct || 100}%) to ${receiver.name} (${receiver.role}) · ${investment.investmentCode || ''}`,
        createdBy: cashierName,
      });
      if (bankLedger?.entry?._id) {
        investment.bankLedgerEntryId = bankLedger.entry._id;
      }
    } catch (error) {
      // Roll back activation if cash debit fails after member funding.
      investment.status = 'pending_cashier_payment';
      investment.cashierProcessedAt = null;
      investment.cashierProcessedBy = '';
      await investment.save();
      error.status = error.status || 409;
      error.code = error.code || 'INSUFFICIENT_BOOK_BALANCE';
      error.funding = await getCashierPaymentFundingSnapshot(investment);
      throw error;
    }
  }

  await investment.save();

  await createAdminNotification({
    type: 'general',
    title: `Investment successful: ${investment.investmentCode}`,
    message: `Cashier completed society payout of ${formatMoney(societyFundingAmount, 2)} to ${receiver.name}.${investment.externalAmount > 0 ? ` External share ${formatMoney(Number(investment.externalAmount), 2)} still needs recording if not already received.` : ''}`,
    relatedId: investment._id,
    relatedModel: 'Investment',
  });

  return {
    investment,
    savingsUpdate,
    funding: savingsUpdate,
    unpaidContributions: (savingsUpdate.contributions || []).filter((c) => c.status === 'unpaid'),
    payoutReceiver: receiver,
    bankLedger,
    societyFundingAmount,
    voucherUrl: bankLedger?.entry?._id
      ? `/api/admin/bank-ledger/entries/${bankLedger.entry._id}/voucher.pdf`
      : `/api/admin/investments/${investment._id}/payout-voucher.pdf`,
    approvalTracking: await buildApprovalTracking(investment),
    message: savingsUpdate.unpaidCount
      ? `Payment completed with ${savingsUpdate.unpaidCount} unpaid member share(s). Project is Successful — cover unpaid shares via internal borrowing when needed.`
      : 'Payment completed. Investment is now Successful.',
  };
}

async function getInvestorPortfolio(investorId) {
  if (!investorId) {
    const error = new Error('Investor ID is required.');
    error.status = 400;
    throw error;
  }

  const investor = await User.findOne({
    _id: investorId,
    role: 'investor',
    status: { $ne: 'deleted' },
  }).select('name email phone address dateOfBirth status createdAt');

  if (!investor) {
    const error = new Error('Investor not found.');
    error.status = 404;
    throw error;
  }

  const investments = await Investment.find({
    member: null,
    $or: [
      { investor: investor._id },
      { investorName: investor.name },
    ],
  })
    .populate('projectManager', 'name email role')
    .sort({ createdAt: -1 });

  for (const investment of investments) {
    await ensureInvestmentCode(investment);
  }

  const grouped = await enrichInvestmentsWithSaleData(investments);
  const byTypeMap = new Map();

  for (const item of grouped.all) {
    const typeKey = item.investmentType || 'Other';
    if (!byTypeMap.has(typeKey)) {
      byTypeMap.set(typeKey, {
        investmentType: typeKey,
        investments: [],
        totalAmount: 0,
        activeAmount: 0,
        soldAmount: 0,
        count: 0,
      });
    }
    const bucket = byTypeMap.get(typeKey);
    bucket.investments.push(item);
    bucket.count += 1;
    bucket.totalAmount += Number(item.amount || 0);
    if (item.status === 'active') {
      bucket.activeAmount += Number(item.amount || 0);
    } else if (item.status === 'sold') {
      bucket.soldAmount += Number(item.amount || 0);
    }
  }

  const byType = [...byTypeMap.values()].map((bucket) => ({
    ...bucket,
    totalAmount: Number(bucket.totalAmount.toFixed(2)),
    activeAmount: Number(bucket.activeAmount.toFixed(2)),
    soldAmount: Number(bucket.soldAmount.toFixed(2)),
  }));

  return {
    investor,
    summary: {
      totalInvestments: grouped.all.length,
      activeCount: grouped.active.length,
      soldCount: grouped.sold.length,
      totalAmount: Number(grouped.all.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
      activeAmount: Number(grouped.active.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
      soldAmount: Number(grouped.sold.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
    },
    byType,
    investments: grouped.all,
  };
}

async function listInvestorPortfolios() {
  const investors = await listInvestorUsers();
  const portfolios = [];

  for (const investor of investors) {
    const portfolio = await getInvestorPortfolio(investor._id);
    portfolios.push({
      investor: portfolio.investor,
      summary: portfolio.summary,
      types: portfolio.byType.map((item) => ({
        investmentType: item.investmentType,
        count: item.count,
        totalAmount: item.totalAmount,
      })),
    });
  }

  return portfolios;
}

async function getInvestmentById(investmentId) {
  const investment = await Investment.findById(investmentId);
  if (!investment) {
    const error = new Error('Investment not found.');
    error.status = 404;
    throw error;
  }
  return investment;
}

async function refundToTotalSavings(amount) {
  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Refund amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const { members, totalSavings } = await getSavingsPool();
  if (!members.length) {
    const error = new Error('No members available to receive refund.');
    error.status = 400;
    throw error;
  }

  const equalShares = splitAmountEqually(normalizedAmount, members.length);
  let allocated = 0;

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const refund = equalShares[index];
    member.savings = Number(member.savings || 0) + refund;
    await member.save();
    allocated += refund;
  }

  return {
    refundedAmount: normalizedAmount,
    totalSavingsAfter: Number((totalSavings + normalizedAmount).toFixed(2)),
  };
}

async function updateInvestment(investmentId, updates = {}) {
  const investment = await getInvestmentById(investmentId);

  if (updates.investorId) {
    const investorUser = await User.findOne({
      _id: updates.investorId,
      role: 'investor',
      status: { $ne: 'deleted' },
    });
    if (!investorUser) {
      const error = new Error('Selected investor was not found.');
      error.status = 404;
      throw error;
    }
    investment.investor = investorUser._id;
    investment.investorName = investorUser.name;
  }

  if (typeof updates.projectManagerId !== 'undefined') {
    if (!updates.projectManagerId) {
      investment.projectManager = null;
    } else {
      const projectManagerUser = await User.findOne({
        _id: updates.projectManagerId,
        role: 'project_manager',
        status: { $ne: 'deleted' },
      });
      if (!projectManagerUser) {
        const error = new Error('Selected project manager was not found.');
        error.status = 404;
        throw error;
      }
      investment.projectManager = projectManagerUser._id;
    }
  }

  if (updates.investmentType?.trim()) {
    investment.investmentType = updates.investmentType.trim();
  }

  const nextName = updates.investorName?.trim() || investment.investorName || investment.partner;
  const nextLocation = updates.location?.trim() || investment.location || investment.sector;
  const nextSector = updates.sector?.trim() || investment.investmentType || nextLocation || investment.sector;
  const nextPartner = updates.partner?.trim() || nextName || investment.partner;
  const nextNotes = typeof updates.notes !== 'undefined' ? updates.notes?.trim() || '' : investment.notes;
  const nextProfit = typeof updates.profit !== 'undefined' ? Number(updates.profit) || 0 : investment.profit;
  const nextDateOfBirth = updates.dateOfBirth
    ? new Date(updates.dateOfBirth)
    : investment.dateOfBirth;

  if (!nextName) {
    const error = new Error('Investor name is required.');
    error.status = 400;
    throw error;
  }

  if (!nextLocation) {
    const error = new Error('Investor location is required.');
    error.status = 400;
    throw error;
  }

  if (nextProfit < 0) {
    const error = new Error('Profit cannot be negative.');
    error.status = 400;
    throw error;
  }

  investment.investorName = nextName;
  investment.location = nextLocation;
  investment.dateOfBirth = nextDateOfBirth && !Number.isNaN(nextDateOfBirth.getTime()) ? nextDateOfBirth : null;
  investment.sector = nextSector;
  investment.partner = nextPartner;
  investment.allocation = nextSector;
  investment.notes = nextNotes;
  investment.profit = nextProfit;
  await investment.save();
  await investment.populate([
    { path: 'investor', select: 'name email role phone address dateOfBirth' },
    { path: 'projectManager', select: 'name email role' },
  ]);

  return investment;
}

async function deleteInvestment(investmentId) {
  const investment = await getInvestmentById(investmentId);
  let refund = null;

  // Only refund society savings for investments that already completed cashier payment
  if (investment.status === 'active' || investment.status === 'sold') {
    refund = await refundToTotalSavings(investment.amount);
  }

  await investment.deleteOne();

  return {
    investment,
    refund,
  };
}

async function getInvestmentSummary(groupedInvestments = null) {
  const grouped = groupedInvestments || await getGroupedSocietyInvestments();
  const { totalSavings } = await getSavingsPool();
  return buildInvestmentSummaryFromGrouped(grouped, totalSavings);
}

function buildInvestmentSummaryFromGrouped(grouped, totalSavings = 0) {
  const activeInvested = grouped.active.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const soldInvested = grouped.sold.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalSoldProceeds = grouped.sold.reduce((sum, item) => sum + Number(item.saleAmount || 0), 0);
  const totalInvested = activeInvested + soldInvested;
  const totalProfit = grouped.sold.reduce((sum, item) => sum + Number(item.netProfitLoss || 0), 0);
  const funded = [...grouped.active, ...grouped.sold];
  const totalWithdrawn = funded.reduce((sum, item) => sum + Number(item.withdrawals || 0), 0);

  return {
    totalSavings,
    totalInvested,
    activeInvested,
    soldInvested,
    totalSoldProceeds,
    totalWithdrawn,
    totalProfit,
    netBalance: totalInvested + totalProfit - totalWithdrawn,
    investmentCount: grouped.all.length,
    activeCount: grouped.active.length,
    soldCount: grouped.sold.length,
    pendingMemberApprovalCount: grouped.pendingMemberApproval.length,
    pendingCashierPaymentCount: grouped.pendingCashierPayment.length,
    pendingCount: grouped.pending.length,
  };
}

module.exports = {
  approveInvestmentByMember,
  buildApprovalTracking,
  buildApprovalTrackingBatch,
  completeCashierPayment,
  previewCashierPayment,
  coverCashierPaymentShortfallFromAdvance,
  coverCashierPaymentShortfallFromReserve,
  getCashierPaymentFundingSnapshot,
  previewMemberShareFunding,
  getInvestmentApprovalDetails,
  getInvestmentDisplayStatus,
  listCashierPaymentQueue,
  listPendingMemberInvestmentRequests,
  calculateInvestmentPerformance,
  createSocietyInvestment,
  deductFromTotalSavings,
  fundInvestmentFromMembers,
  deleteInvestment,
  ensureInvestmentCode,
  enrichInvestmentsWithSaleData,
  generateInvestmentCode,
  getAllInvestments,
  getGroupedSocietyInvestments,
  getInvestmentByCode,
  getInvestmentById,
  getInvestmentSummary,
  buildInvestmentSummaryFromGrouped,
  getInvestorPortfolio,
  getMemberInvestments,
  getProjectManagerPortfolio,
  getSavingsPool,
  listInvestorPortfolios,
  listInvestorUsers,
  listProjectManagers,
  refundToTotalSavings,
  updateInvestment,
};
