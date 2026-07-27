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
    const error = new Error(`Insufficient total savings. Available: $${totalSavings.toFixed(2)}`);
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

async function enrichInvestmentsWithSaleData(investments) {
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

    const isSold = plain.status === 'sold' || Boolean(record);

    if (isSold) {
      const outcomeType = plain.outcomeType || record?.outcomeType || 'profit';
      const profitAmount = Number(record?.profitAmount || Math.abs(Number(plain.profit || 0)));
      const saleAmount = Number(plain.saleAmount || record?.saleAmount || 0);
      const soldAt = plain.soldAt || record?.createdAt || null;

      if (plain.status !== 'sold' && record) {
        await Investment.updateOne(
          { _id: plain._id },
          {
            $set: {
              status: 'sold',
              saleAmount,
              outcomeType,
              soldAt,
            },
          }
        );
      }

      enriched.push({
        ...plain,
        status: 'sold',
        saleAmount,
        outcomeType,
        soldAt,
        netProfitLoss: outcomeType === 'loss' ? -profitAmount : profitAmount,
        displayStatus: 'Sold',
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

  return {
    active: enriched.filter((item) => item.status === 'active'),
    sold: enriched.filter((item) => item.status === 'sold'),
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
    case 'rejected':
      return 'Rejected';
    default:
      return status || 'Unknown';
  }
}

async function getGroupedSocietyInvestments() {
  const investments = await Investment.find(SOCIETY_INVESTMENT_FILTER)
    .populate('investor', 'name email role phone address dateOfBirth')
    .populate('projectManager', 'name email role')
    .sort({ createdAt: -1 });

  for (const investment of investments) {
    await ensureInvestmentCode(investment);
  }

  return enrichInvestmentsWithSaleData(investments);
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
    amount: Number(amount),
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
  const notifyMessage = `${normalizedName} · ${normalizedType} · $${Number(amount).toFixed(2)}. Please review and approve.`;

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

async function buildApprovalTracking(investment) {
  const eligibleIds = (investment.eligibleMembers || []).map((id) => String(id));
  const approvedIds = new Set((investment.approvals || []).map((item) => String(item.member)));

  const members = await User.find({ _id: { $in: investment.eligibleMembers || [] } })
    .select('name email status')
    .lean();

  const memberById = new Map(members.map((member) => [String(member._id), member]));
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

async function approveInvestmentByMember(investmentId, memberId) {
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

  const receiver = resolvePayoutReceiver(investment, {
    payoutReceiverRole,
    payoutReceiverName,
    payoutReceiverEmail,
    payoutAccountName,
    payoutAccountNumber,
    payoutBankName,
  });

  const savingsUpdate = await fundInvestmentFromMembers(investment._id, investment.amount);
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
  try {
    const { tryDebit } = require('./bankLedgerService');
    bankLedger = await tryDebit({
      type: 'project_payout',
      amount: investment.amount,
      referenceType: 'Investment',
      referenceId: investment._id,
      note: `Project payout to ${receiver.name} (${receiver.role}) · ${investment.investmentCode || ''}`,
      createdBy: cashierName,
    });
    if (bankLedger?.entry?._id) {
      investment.bankLedgerEntryId = bankLedger.entry._id;
    }
  } catch (error) {
    console.warn('[completeCashierPayment] bank ledger debit failed:', error.message);
  }

  await investment.save();

  await createAdminNotification({
    type: 'general',
    title: `Investment successful: ${investment.investmentCode}`,
    message: `Cashier completed payment of $${Number(investment.amount).toFixed(2)} to ${receiver.name}.`,
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

async function getInvestmentSummary() {
  const grouped = await getGroupedSocietyInvestments();
  const { members, totalSavings } = await getSavingsPool();
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
  completeCashierPayment,
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
