const { formatMoney } = require('./moneyFormat');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { sendTransactionalEmail, generateLoanContractPdf, formatPaymentMethodLabel } = require('./notificationService');
const { sendSms } = require('./smsService');

const LOAN_LIMIT_RATIO = 0.8;
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'mobile_banking', 'check', 'other'];

function saveLoanContractFile(loanId, pdfBuffer) {
  const contractsDir = path.join(__dirname, '..', 'uploads', 'contracts');
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
  const filename = `loan-contract-${loanId}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(contractsDir, filename), pdfBuffer);
  return `/uploads/contracts/${filename}`;
}

async function generateLoanContractForApplication(loan, member, adminName) {
  const pdfBuffer = await generateLoanContractPdf(loan, member, adminName);
  const contractPath = saveLoanContractFile(loan._id, pdfBuffer);
  loan.contractPath = contractPath;
  loan.contractGeneratedAt = new Date();
  return contractPath;
}

function calculateLoanEligibility(savings = 0) {
  const normalizedSavings = Number(savings) || 0;
  const maxEligibleAmount = Number((normalizedSavings * LOAN_LIMIT_RATIO).toFixed(2));
  return {
    totalSavings: normalizedSavings,
    maxEligibleAmount,
    theoreticalMaxLoan: maxEligibleAmount,
    limitPercent: LOAN_LIMIT_RATIO * 100,
  };
}

async function getGeneralLoanUsage(memberId, excludeLoanId = null) {
  const loans = await LoanApplication.find({
    member: memberId,
    loanType: 'general',
    status: { $in: ['pending', 'approved', 'disbursed'] },
    autoRejected: { $ne: true },
  }).lean();

  return loans
    .filter((loan) => !excludeLoanId || String(loan._id) !== String(excludeLoanId))
    .reduce((sum, loan) => {
      if (loan.status === 'disbursed') {
        const outstanding = loan.outstandingBalance !== undefined && loan.outstandingBalance !== null
          ? Number(loan.outstandingBalance)
          : Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0);
        if (loan.repaymentStatus === 'paid_off' || outstanding <= 0) {
          return sum;
        }
        return sum + outstanding;
      }
      return sum + Number(loan.amount || 0);
    }, 0);
}

async function buildMemberLoanEligibility(member) {
  const baseEligibility = calculateLoanEligibility(member.savings);
  const usedGeneralLoanAmount = await getGeneralLoanUsage(member._id);
  const availableMaxLoan = Math.max(
    0,
    Number((baseEligibility.maxEligibleAmount - usedGeneralLoanAmount).toFixed(2))
  );

  return {
    totalSavings: baseEligibility.totalSavings,
    theoreticalMaxLoan: baseEligibility.maxEligibleAmount,
    usedGeneralLoanAmount,
    availableMaxLoan,
    maxEligibleAmount: availableMaxLoan,
    generalMaxLoan: availableMaxLoan,
    limitPercent: baseEligibility.limitPercent,
    emergencyUnlimited: true,
    status: member.status || 'active',
  };
}

function exceedsAvailableGeneralLoan(amount, availableMaxLoan) {
  const normalizedAmount = Number(amount) || 0;
  return normalizedAmount > Number(availableMaxLoan || 0);
}

function exceedsLoanLimit(amount, savings, loanType = 'general', availableMaxLoan = null) {
  if (loanType === 'emergency') {
    return false;
  }
  if (availableMaxLoan !== null && availableMaxLoan !== undefined) {
    return exceedsAvailableGeneralLoan(amount, availableMaxLoan);
  }
  const normalizedAmount = Number(amount) || 0;
  const { maxEligibleAmount } = calculateLoanEligibility(savings);
  return normalizedAmount > maxEligibleAmount;
}

function validateLoanApplicationInput({
  loanType,
  reason,
  witnessName,
  witnessPhone,
  documents = [],
}) {
  const normalizedType = loanType === 'emergency' ? 'emergency' : 'general';

  if (!reason?.trim()) {
    const error = new Error(normalizedType === 'emergency'
      ? 'Emergency reason is required.'
      : 'Loan purpose/reason is required.');
    error.status = 400;
    throw error;
  }

  if (!witnessName?.trim() || !witnessPhone?.trim()) {
    const error = new Error('Witness name and phone are required.');
    error.status = 400;
    throw error;
  }

  if (!documents.length) {
    const error = new Error('At least one supporting document is required.');
    error.status = 400;
    throw error;
  }

  return normalizedType;
}

async function getLoanEligibility(memberId) {
  const member = await User.findOne({ _id: memberId, role: 'member' }).select('savings status');
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  return buildMemberLoanEligibility(member);
}

async function createLoanApplication({
  memberId,
  amount,
  loanType = 'general',
  reason,
  witnessName,
  witnessPhone,
  witnessRelation,
  documents = [],
}) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (member.status === 'inactive') {
    const error = new Error('Inactive members cannot apply for loans.');
    error.status = 403;
    throw error;
  }
  if (member.status === 'deleted') {
    const error = new Error('Removed members cannot apply for loans.');
    error.status = 403;
    throw error;
  }

  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Loan amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const normalizedType = validateLoanApplicationInput({
    loanType,
    reason,
    witnessName,
    witnessPhone,
    documents,
  });

  const pendingLoan = await LoanApplication.findOne({
    member: memberId,
    status: { $in: ['pending', 'approved'] },
    autoRejected: { $ne: true },
  });

  if (pendingLoan) {
    const error = new Error('You already have a pending or approved loan application.');
    error.status = 400;
    throw error;
  }

  const eligibility = await buildMemberLoanEligibility(member);
  const isOverLimit = normalizedType === 'general'
    && exceedsAvailableGeneralLoan(normalizedAmount, eligibility.availableMaxLoan);

  const loan = await LoanApplication.create({
    member: memberId,
    amount: normalizedAmount,
    loanType: normalizedType,
    reason: reason.trim(),
    witnessName: witnessName.trim(),
    witnessPhone: witnessPhone.trim(),
    witnessRelation: witnessRelation?.trim() || '',
    documents,
    memberSavingsAtApply: eligibility.totalSavings,
    maxEligibleAmount: normalizedType === 'general' ? eligibility.theoreticalMaxLoan : 0,
    status: isOverLimit ? 'rejected' : 'pending',
    autoRejected: isOverLimit,
    rejectionReason: isOverLimit
      ? `Loan amount exceeds remaining general loan limit. Available: ${formatMoney(eligibility.availableMaxLoan, 2)} (80% savings limit minus active general loans).`
      : '',
    adminNote: isOverLimit
      ? 'Automatically rejected because requested amount is above the remaining 80% savings loan limit.'
      : '',
  });

  if (isOverLimit) {
    if (member.email) {
      await sendTransactionalEmail({
        to: member.email,
        subject: 'Loan Application Auto-Rejected',
        text: `Dear ${member.name}, your ${normalizedType} loan application for ${formatMoney(normalizedAmount, 2)} was automatically rejected. Remaining general loan limit: ${formatMoney(eligibility.availableMaxLoan, 2)} (total 80% cap: ${formatMoney(eligibility.theoreticalMaxLoan, 2)}, already used: ${formatMoney(eligibility.usedGeneralLoanAmount, 2)}).`,
        html: `<p>Dear ${member.name},</p><p>Your <strong>${normalizedType}</strong> loan application for <strong>${formatMoney(normalizedAmount, 2)}</strong> was automatically rejected because it exceeds your <strong>remaining</strong> general loan limit.</p><p>Total savings: ${formatMoney(eligibility.totalSavings, 2)}<br>80% cap: ${formatMoney(eligibility.theoreticalMaxLoan, 2)}<br>Already reserved in general loans: ${formatMoney(eligibility.usedGeneralLoanAmount, 2)}<br>Available now: ${formatMoney(eligibility.availableMaxLoan, 2)}</p>`,
      });
    }

    if (member.phone) {
      await sendSms({
        to: member.phone,
        message: `Loan auto-rejected: exceeds remaining limit. Available: ${formatMoney(eligibility.availableMaxLoan, 2)}.`,
      });
    }

    await createMemberNotification({
      memberId,
      type: 'loan',
      title: 'Loan Application Auto-Rejected',
      message: `Your ${normalizedType} loan application for ${formatMoney(normalizedAmount, 2)} was auto-rejected.`,
      relatedId: loan._id,
      relatedModel: 'LoanApplication',
    });

    return { loan, autoRejected: true };
  }

  await createMemberNotification({
    memberId,
    type: 'loan',
    title: 'Loan Application Submitted',
    message: `Your ${normalizedType} loan application for ${formatMoney(normalizedAmount, 2)} was submitted and is awaiting CEO review.`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  await createAdminNotification({
    type: 'loan',
    title: `New ${normalizedType === 'emergency' ? 'Emergency ' : ''}Loan Application from ${member.name} (CEO review)`,
    message: `${member.name} requested a ${normalizedType} loan of ${formatMoney(normalizedAmount, 2)}. Awaiting CEO approval before Cashier disbursement. Reason: ${reason.trim()}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  if (process.env.ADMIN_ALERT_EMAIL) {
    await sendTransactionalEmail({
      to: process.env.ADMIN_ALERT_EMAIL,
      subject: `New ${normalizedType} Loan Application - ${member.name}`,
      text: `${member.name} submitted a ${normalizedType} loan application for ${formatMoney(normalizedAmount, 2)}.`,
      html: `<p><strong>${member.name}</strong> submitted a <strong>${normalizedType}</strong> loan application for <strong>${formatMoney(normalizedAmount, 2)}</strong>.</p><p>Reason: ${reason.trim()}</p>`,
    });
  }

  if (process.env.ADMIN_ALERT_PHONE) {
    await sendSms({
      to: process.env.ADMIN_ALERT_PHONE,
      message: `New ${normalizedType} loan from ${member.name}: ${formatMoney(normalizedAmount, 2)}`,
    });
  }

  return { loan, autoRejected: false };
}

async function getLoanApplicationsForMember(memberId) {
  return LoanApplication.find({ member: memberId }).sort({ createdAt: -1 }).lean();
}

async function getLoanApplicationsForAdmin(filters = {}) {
  const query = {};
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.loanType) {
    query.loanType = filters.loanType;
  }

  return LoanApplication.find(query)
    .populate({ path: 'member', select: 'name email phone savings profit status' })
    .sort({ createdAt: -1 })
    .lean();
}

function getLoanOutstandingAmount(loan = {}) {
  if (loan.status === 'completed' || loan.repaymentStatus === 'paid_off') {
    return 0;
  }
  if (loan.status !== 'disbursed') {
    return 0;
  }
  const outstanding = loan.outstandingBalance !== undefined && loan.outstandingBalance !== null
    ? Number(loan.outstandingBalance)
    : Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0);
  return Math.max(outstanding, 0);
}

function getCurrentMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function enrichRowsWithMonthlyRepayments(rows = []) {
  if (!rows.length) {
    return rows;
  }

  const monthStart = getCurrentMonthStart();
  const memberIds = rows.map((entry) => entry.memberId).filter(Boolean);
  const repayments = await LoanRepayment.find({
    member: { $in: memberIds },
    status: 'approved',
  })
    .sort({ approvedAt: -1, createdAt: -1 })
    .lean();

  const latestPaymentByMember = new Map();
  const paidThisMonthSet = new Set();

  repayments.forEach((repayment) => {
    const memberId = String(repayment.member);
    if (!latestPaymentByMember.has(memberId)) {
      latestPaymentByMember.set(memberId, repayment);
    }

    const paymentDate = repayment.approvedAt || repayment.createdAt;
    if (paymentDate && new Date(paymentDate) >= monthStart) {
      paidThisMonthSet.add(memberId);
    }
  });

  return rows.map((entry) => {
    const memberId = String(entry.memberId);
    const latestPayment = latestPaymentByMember.get(memberId);
    const paymentDate = latestPayment?.approvedAt || latestPayment?.createdAt || null;
    return {
      ...entry,
      paidThisMonth: paidThisMonthSet.has(memberId),
      lastPaymentDate: paymentDate,
      lastPaymentAmount: latestPayment ? Number(latestPayment.amount || 0) : 0,
    };
  });
}

async function buildLoanTakerRows() {
  const loans = await LoanApplication.find({})
    .populate({ path: 'member', select: 'name email phone savings profit status' })
    .sort({ createdAt: -1 })
    .lean();

  const byMember = new Map();

  loans.forEach((loan) => {
    const member = loan.member;
    const memberId = String(member?._id || loan.member || '');
    if (!memberId || memberId === 'undefined') {
      return;
    }
    if (member?.status === 'deleted') {
      return;
    }

    if (!byMember.has(memberId)) {
      byMember.set(memberId, {
        member,
        memberId,
        totalApplications: 0,
        approvedApplications: 0,
        disbursedApplications: 0,
        totalBorrowed: 0,
        totalRepaid: 0,
        totalOutstanding: 0,
        lastLoanDate: loan.createdAt,
        lastLoanType: loan.loanType,
        lastLoanStatus: loan.status,
      });
    }

    const entry = byMember.get(memberId);
    entry.totalApplications += 1;
    if (['approved', 'disbursed'].includes(loan.status)) {
      entry.approvedApplications += 1;
      entry.totalBorrowed += Number(loan.amount || 0);
    }
    if (loan.status === 'disbursed') {
      entry.disbursedApplications += 1;
      entry.totalRepaid += Number(loan.totalRepaid || 0);
      entry.totalOutstanding += getLoanOutstandingAmount(loan);
    }
    if (new Date(loan.createdAt) > new Date(entry.lastLoanDate)) {
      entry.lastLoanDate = loan.createdAt;
      entry.lastLoanType = loan.loanType;
      entry.lastLoanStatus = loan.status;
    }
  });

  return Array.from(byMember.values()).sort(
    (a, b) => new Date(b.lastLoanDate) - new Date(a.lastLoanDate)
  );
}

async function getAllLoanTakers() {
  const takers = await buildLoanTakerRows();
  const disbursedTakers = takers.filter((entry) => entry.disbursedApplications > 0);
  return enrichRowsWithMonthlyRepayments(disbursedTakers);
}

async function getActiveBorrowers(filters = {}) {
  const takers = await buildLoanTakerRows();
  let borrowers = takers.filter((entry) => entry.totalOutstanding > 0);
  borrowers = await enrichRowsWithMonthlyRepayments(borrowers);

  if (filters.monthlyStatus === 'paid') {
    borrowers = borrowers.filter((entry) => entry.paidThisMonth);
  } else if (filters.monthlyStatus === 'not_paid') {
    borrowers = borrowers.filter((entry) => !entry.paidThisMonth);
  }

  return borrowers;
}

async function getLoanPortfolioSummary() {
  const takers = await getAllLoanTakers();
  const activeBorrowers = await getActiveBorrowers();
  const paidThisMonth = activeBorrowers.filter((entry) => entry.paidThisMonth);
  const notPaidThisMonth = activeBorrowers.filter((entry) => !entry.paidThisMonth);
  const totalOutstanding = activeBorrowers.reduce(
    (sum, entry) => sum + Number(entry.totalOutstanding || 0),
    0
  );

  return {
    totalLoanTakers: takers.length,
    activeBorrowers: activeBorrowers.length,
    paidThisMonth: paidThisMonth.length,
    notPaidThisMonth: notPaidThisMonth.length,
    totalOutstanding: Number(totalOutstanding.toFixed(2)),
    currentMonthLabel: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

async function getLoanApplicationById(loanId) {
  return LoanApplication.findById(loanId)
    .populate({ path: 'member', select: 'name email phone savings profit status' })
    .lean();
}

async function getLoansByMemberId(memberId) {
  return LoanApplication.find({ member: memberId }).sort({ createdAt: -1 }).lean();
}

async function getMemberLoanDashboardSummary(memberId) {
  const member = await User.findOne({ _id: memberId, role: 'member' }).select('savings status');
  const loans = await getLoansByMemberId(memberId);
  const activeLoan = loans.find((loan) => {
    if (['pending', 'approved'].includes(loan.status)) return true;
    if (loan.status === 'disbursed' && loan.repaymentStatus !== 'paid_off') {
      const outstanding = loan.outstandingBalance != null
        ? Number(loan.outstandingBalance)
        : Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0);
      return outstanding > 0;
    }
    return false;
  }) || null;
  const latestDecision = loans.find((loan) => ['approved', 'rejected', 'disbursed', 'completed'].includes(loan.status)) || null;
  const eligibility = member ? await buildMemberLoanEligibility(member) : null;

  return {
    loans,
    activeLoan,
    latestDecision,
    eligibility,
    hasPendingApplication: loans.some((loan) => loan.status === 'pending'),
    hasOutstandingLoan: Boolean(
      activeLoan && activeLoan.status === 'disbursed' && activeLoan.repaymentStatus !== 'paid_off'
    ),
    totalApplications: loans.length,
  };
}

async function getLoanContractFile(loanId) {
  const loan = await LoanApplication.findById(loanId).lean();
  if (!loan?.contractPath) {
    const error = new Error('Loan contract not found.');
    error.status = 404;
    throw error;
  }

  const relativePath = loan.contractPath.replace(/^\/uploads\//, '');
  const fullPath = path.join(__dirname, '..', 'uploads', relativePath);
  if (!fs.existsSync(fullPath)) {
    const error = new Error('Contract file is missing.');
    error.status = 404;
    throw error;
  }

  return { loan, fullPath };
}

async function uploadSignedLoanContract(loanId, memberId, signedContractPath) {
  const loan = await LoanApplication.findOne({ _id: loanId, member: memberId });
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }

  if (!['approved', 'disbursed'].includes(loan.status)) {
    const error = new Error('Signed contract can only be uploaded for approved loans.');
    error.status = 400;
    throw error;
  }

  loan.signedContractPath = signedContractPath;
  loan.signedContractUploadedAt = new Date();
  await loan.save();
  return loan;
}

async function updateLoanApplicationStatus(loanId, status, adminNote = '', reviewedBy = 'Admin', paymentMethod = '') {
  const allowedStatuses = ['pending', 'approved', 'rejected', 'disbursed'];
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid loan status.');
    error.status = 400;
    throw error;
  }

  const loan = await LoanApplication.findById(loanId).populate({ path: 'member', select: 'name email phone savings' });
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }

  if (loan.autoRejected) {
    const error = new Error('This application was auto-rejected and cannot be updated.');
    error.status = 400;
    throw error;
  }

  if (status === 'approved' || status === 'disbursed') {
    const memberSavings = Number(loan.member?.savings || loan.memberSavingsAtApply || 0);
    if (loan.loanType === 'general') {
      const usedGeneralLoanAmount = await getGeneralLoanUsage(loan.member._id, loan._id);
      const theoreticalMaxLoan = calculateLoanEligibility(memberSavings).maxEligibleAmount;
      const availableMaxLoan = Math.max(0, Number((theoreticalMaxLoan - usedGeneralLoanAmount).toFixed(2)));
      if (exceedsAvailableGeneralLoan(loan.amount, availableMaxLoan)) {
        const error = new Error(`Cannot approve: loan amount exceeds remaining general loan limit (${formatMoney(availableMaxLoan, 2)}).`);
        error.status = 400;
        throw error;
      }
    }
  }

  if (status === 'approved') {
    const normalizedPaymentMethod = paymentMethod?.trim() || loan.paymentMethod || '';
    if (!PAYMENT_METHODS.includes(normalizedPaymentMethod)) {
      const error = new Error('Payment method is required when approving a loan.');
      error.status = 400;
      throw error;
    }
    loan.paymentMethod = normalizedPaymentMethod;
    loan.approvedAt = new Date();
  }

  if (status === 'disbursed') {
    const error = new Error('Use the loan disbursement transfer action to send money to the member.');
    error.status = 400;
    throw error;
  }

  loan.status = status;
  loan.adminNote = adminNote?.trim() || loan.adminNote || '';
  loan.reviewedBy = reviewedBy?.trim() || 'Admin';
  if (status === 'rejected' && adminNote?.trim()) {
    loan.rejectionReason = adminNote.trim();
  }

  if (status === 'approved' && !loan.contractPath) {
    await generateLoanContractForApplication(loan, loan.member, reviewedBy);
  }

  await loan.save();

  const member = loan.member;
  const paymentLabel = formatPaymentMethodLabel(loan.paymentMethod);
  if (member?.email) {
    const contractNote = status === 'approved' && loan.contractPath
      ? '<p>Your formal loan contract is ready. Please log in to your dashboard to download, sign, and submit it.</p>'
      : '';
    const paymentNote = status === 'approved' && loan.paymentMethod
      ? `<p>Payment method: <strong>${paymentLabel}</strong></p>`
      : '';

    await sendTransactionalEmail({
      to: member.email,
      subject: `Loan Application ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      text: `Dear ${member.name}, your ${loan.loanType} loan application for ${formatMoney(Number(loan.amount), 2)} is now ${status}.${loan.paymentMethod ? ` Payment method: ${paymentLabel}.` : ''}`,
      html: `<p>Dear ${member.name},</p><p>Your <strong>${loan.loanType}</strong> loan application for <strong>${formatMoney(Number(loan.amount), 2)}</strong> is now <strong>${status}</strong>.</p>${paymentNote}${loan.adminNote ? `<p>Note: ${loan.adminNote}</p>` : ''}${contractNote}`,
    });
  }

  if (member?.phone) {
    await sendSms({
      to: member.phone,
      message: `Loan update: your ${loan.loanType} loan for ${formatMoney(Number(loan.amount), 2)} is now ${status}.${loan.paymentMethod ? ` Payment: ${paymentLabel}.` : ''}`,
    });
  }

  await createMemberNotification({
    memberId: loan.member._id || loan.member,
    type: 'loan',
    title: `Loan Application ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    message: status === 'approved'
      ? `Your ${loan.loanType} loan application for ${formatMoney(Number(loan.amount), 2)} was approved by the CEO and forwarded to the Cashier for disbursement.${loan.adminNote ? ` Note: ${loan.adminNote}` : ''}`
      : `Your ${loan.loanType} loan application for ${formatMoney(Number(loan.amount), 2)} is now ${status}.${loan.adminNote ? ` Note: ${loan.adminNote}` : ''}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  if (status === 'approved') {
    await createAdminNotification({
      type: 'loan',
      title: 'Loan approved — awaiting Cashier disbursement',
      message: `${member?.name || 'Member'}'s ${loan.loanType} loan of ${formatMoney(Number(loan.amount), 2)} was approved and is ready for Cashier payout.`,
      relatedId: loan._id,
      relatedModel: 'LoanApplication',
    });
  }

  return loan;
}

async function getLoanDisbursementFundingSnapshot(loan) {
  const requiredAmount = Number(Number(loan.amount || 0).toFixed(2));
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

  const shortfall = Number(Math.max(0, requiredAmount - bookBalance).toFixed(2));
  const totalAdvanceAvailable = Number(
    advances.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0).toFixed(2)
  );
  const canDisburseDirectly = openingSet && shortfall <= 0.001;

  return {
    loanId: loan._id,
    status: loan.status,
    requiredAmount,
    bookBalance,
    openingSet,
    shortfall,
    hasShortfall: shortfall > 0.001,
    canComplete: canDisburseDirectly,
    canCompleteDirectly: canDisburseDirectly,
    canDisburseDirectly,
    needsPopup: !canDisburseDirectly,
    reserveBalance,
    totalAdvanceAvailable,
    advanceMembers: advances,
    member: loan.member
      ? {
        id: loan.member._id || loan.member,
        name: loan.member.name || '',
        email: loan.member.email || '',
      }
      : null,
    loan: {
      _id: loan._id,
      amount: loan.amount,
      loanType: loan.loanType,
      status: loan.status,
      paymentMethod: loan.paymentMethod || '',
    },
    coverOptions: {
      canUseReserve: reserveBalance > 0.001,
      canUseAdvance: totalAdvanceAvailable > 0.001,
      maxCoverable: Number(Math.min(shortfall, reserveBalance + totalAdvanceAvailable).toFixed(2)),
    },
  };
}

/**
 * Pre-flight check before loan Disburse — used by the shortfall modal.
 */
async function previewLoanDisbursement(loanId) {
  const loan = await LoanApplication.findById(loanId)
    .populate('member', 'name email phone role');
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }
  if (loan.status !== 'approved') {
    const error = new Error('Only approved loans can be disbursed.');
    error.status = 400;
    throw error;
  }

  const funding = await getLoanDisbursementFundingSnapshot(loan);
  let message;
  if (funding.canDisburseDirectly) {
    message = `Book balance covers ${formatMoney(funding.requiredAmount, 2)}. Disbursement can complete directly.`;
  } else if (!funding.openingSet) {
    message = 'Bank ledger opening balance is not set. Set it before disbursing the loan.';
  } else if (funding.hasShortfall) {
    message = `Book balance shortfall of ${formatMoney(funding.shortfall, 2)}. Cover it from member advance (internal borrow) or Emergency / Reserve Fund before disbursing.`;
  } else {
    message = 'Resolve funding issues before disbursing.';
  }

  return {
    ...funding,
    message,
  };
}

/**
 * Cover loan disbursement book-balance shortfall from a member's advance.
 * Debits lender advance → credits society book → opens InternalBorrowing linked to the loan.
 */
async function coverLoanDisbursementFromAdvance({
  loanId,
  lenderId,
  amount,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  const loan = await LoanApplication.findById(loanId).populate('member', 'name email');
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }
  if (loan.status !== 'approved') {
    const error = new Error('Only approved loans can receive disbursement funding covers.');
    error.status = 400;
    throw error;
  }

  const snapshot = await getLoanDisbursementFundingSnapshot(loan);
  if (!snapshot.openingSet) {
    const error = new Error('Set the bank ledger opening balance before covering a loan shortfall.');
    error.status = 409;
    error.funding = snapshot;
    throw error;
  }
  if (!(snapshot.shortfall > 0.001)) {
    const error = new Error('There is no book-balance shortfall to cover for this loan.');
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

  const borrowerId = loan.member?._id || loan.member;
  lender.advanceBalance = Number((advanceAvail - payAmount).toFixed(2));
  await lender.save();

  const InternalBorrowing = require('../models/InternalBorrowing');
  const borrowing = await InternalBorrowing.create({
    investment: null,
    contribution: null,
    loan: loan._id,
    lender: lender._id,
    lenderName: lender.name,
    borrower: borrowerId,
    borrowerName: loan.member?.name || 'Loan borrower',
    amount: payAmount,
    amountSettled: 0,
    status: 'open',
    note: note?.trim()
      || `Internal borrow from ${lender.name} advance to cover loan disbursement shortfall for ${loan.member?.name || 'member'}`,
    createdBy: String(createdBy || 'Cashier').trim(),
  });

  const { creditInbound } = require('./bankLedgerService');
  const bankLedger = await creditInbound({
    type: 'deposit',
    amount: payAmount,
    referenceType: 'InternalBorrowing',
    referenceId: borrowing._id,
    note: `Advance released to book for loan disbursement shortfall · lender ${lender.name} · borrower ${loan.member?.name || ''}`,
    createdBy,
    paymentChannel: 'cash',
  });

  loan.fundingAdvanceAmount = Number(
    (Number(loan.fundingAdvanceAmount || 0) + payAmount).toFixed(2)
  );
  if (!loan.fundingLenderName) {
    loan.fundingLenderName = lender.name;
  } else if (!String(loan.fundingLenderName).includes(lender.name)) {
    loan.fundingLenderName = `${loan.fundingLenderName}, ${lender.name}`;
  }
  await loan.save();

  const funding = await getLoanDisbursementFundingSnapshot(loan);
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
 * Cover loan disbursement book-balance shortfall from Emergency / Reserve Fund.
 * Debits reserve → credits society book (ready for bank-path disbursement).
 */
async function coverLoanDisbursementFromReserve({
  loanId,
  amount,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  const loan = await LoanApplication.findById(loanId).populate('member', 'name email');
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }
  if (loan.status !== 'approved') {
    const error = new Error('Only approved loans can receive disbursement funding covers.');
    error.status = 400;
    throw error;
  }

  const snapshot = await getLoanDisbursementFundingSnapshot(loan);
  if (!snapshot.openingSet) {
    const error = new Error('Set the bank ledger opening balance before covering a loan shortfall.');
    error.status = 409;
    error.funding = snapshot;
    throw error;
  }
  if (!(snapshot.shortfall > 0.001)) {
    const error = new Error('There is no book-balance shortfall to cover for this loan.');
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

  const { debitReserve } = require('./emergencyReserveService');
  const { creditInbound } = require('./bankLedgerService');

  const reserveResult = await debitReserve(payAmount, {
    type: 'loan_cover',
    note: note?.trim()
      || `Released to book for loan disbursement shortfall · ${loan.member?.name || 'member'}`,
    createdBy,
    referenceType: 'LoanApplication',
    referenceId: loan._id,
  });

  const bankLedger = await creditInbound({
    type: 'reserve_disbursement',
    amount: payAmount,
    referenceType: 'EmergencyReserveFund',
    referenceId: reserveResult.fund?._id || null,
    note: `Emergency/Reserve → book for loan disbursement · ${loan.member?.name || ''}`,
    createdBy,
  });

  loan.fundingReserveAmount = Number(
    (Number(loan.fundingReserveAmount || 0) + payAmount).toFixed(2)
  );
  loan.fundingReserveOutstanding = Number(
    (Number(loan.fundingReserveOutstanding || 0) + payAmount).toFixed(2)
  );
  await loan.save();

  const funding = await getLoanDisbursementFundingSnapshot(loan);
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

function resolveLoanFundingSourceLabel(loan) {
  const source = String(loan.fundingSource || '').toLowerCase();
  if (source === 'reserve') return 'Emergency / Reserve Fund';
  if (source === 'advance') return 'Internal borrow (member advance)';
  if (source === 'mixed') {
    const parts = [];
    if (Number(loan.fundingAdvanceAmount || 0) > 0) parts.push('member advance');
    if (Number(loan.fundingReserveAmount || 0) > 0) parts.push('Emergency / Reserve Fund');
    parts.push('society book balance');
    return `Mixed (${parts.join(' + ')})`;
  }
  if (source === 'bank') return 'Society book balance';
  return 'Society book balance';
}

async function disburseLoanApplication(loanId, {
  paymentMethod = '',
  transferReference = '',
  disbursementNote = '',
  disbursedBy = 'Admin',
  fundingSource = 'bank',
  allowShortfall = false,
} = {}) {
  const loan = await LoanApplication.findById(loanId).populate({ path: 'member', select: 'name email phone savings' });
  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }

  if (loan.autoRejected) {
    const error = new Error('This application was auto-rejected and cannot be disbursed.');
    error.status = 400;
    throw error;
  }

  if (loan.status !== 'approved') {
    const error = new Error('Only approved loans can be disbursed. Approve the loan first.');
    error.status = 400;
    throw error;
  }

  const normalizedPaymentMethod = paymentMethod?.trim() || loan.paymentMethod || '';
  if (!PAYMENT_METHODS.includes(normalizedPaymentMethod)) {
    const error = new Error('Transfer method is required to disburse the loan.');
    error.status = 400;
    throw error;
  }

  const requestedSource = String(fundingSource || 'bank').toLowerCase() === 'reserve' ? 'reserve' : 'bank';
  const amount = Number(loan.amount || 0);

  // Bank path: require sufficient book balance (or prior cover). On shortfall, return funding payload for modal.
  if (requestedSource === 'bank' && !allowShortfall) {
    const funding = await getLoanDisbursementFundingSnapshot(loan);
    if (!funding.openingSet || funding.hasShortfall) {
      const error = new Error(
        !funding.openingSet
          ? 'Bank ledger opening balance is not set. Set it before disbursing, or cover the shortfall in the disbursement popup.'
          : `Insufficient bank ledger balance for this debit. Shortfall ${formatMoney(funding.shortfall, 2)}.`
      );
      error.status = 409;
      error.funding = {
        ...funding,
        message: !funding.openingSet
          ? 'Bank ledger opening balance is not set. Set it before disbursing.'
          : `Book balance shortfall of ${formatMoney(funding.shortfall, 2)}. Cover it from member advance or Emergency / Reserve Fund, then disburse.`,
        needsPopup: true,
      };
      throw error;
    }
  }

  // Reserve path: earmarked cash leaves the Emergency / Reserve Fund (already taken from book when allocated).
  // Bank path: debit society book balance directly.
  let reserveResult = null;
  let ledgerResult = null;
  if (requestedSource === 'reserve') {
    const { debitReserve } = require('./emergencyReserveService');
    reserveResult = await debitReserve(amount, {
      type: 'loan_disbursement',
      note: `Loan disbursement (${loan.loanType || 'loan'}) → ${loan.member?.name || 'member'} from Emergency / Reserve Fund`,
      createdBy: disbursedBy,
      referenceType: 'LoanApplication',
      referenceId: loan._id,
    });
    loan.fundingReserveAmount = Number(
      (Number(loan.fundingReserveAmount || 0) + amount).toFixed(2)
    );
    loan.fundingReserveOutstanding = Number(
      (Number(loan.fundingReserveOutstanding || 0) + amount).toFixed(2)
    );
  } else {
    const { debit: ledgerDebit } = require('./bankLedgerService');
    try {
      ledgerResult = await ledgerDebit({
        type: 'loan_disbursement',
        amount,
        referenceType: 'LoanApplication',
        referenceId: loan._id,
        note: `Loan disbursement ${loan.loanType || ''} → ${loan.member?.name || 'member'}`,
        createdBy: disbursedBy,
      });
    } catch (error) {
      const funding = await getLoanDisbursementFundingSnapshot(loan).catch(() => null);
      const err = new Error(error.message || 'Unable to debit book balance for loan disbursement.');
      err.status = error.status || 400;
      if (funding) {
        err.funding = {
          ...funding,
          needsPopup: true,
          message: funding.message
            || `Book balance shortfall of ${formatMoney(funding.shortfall, 2)}. Cover it before disbursing.`,
        };
      }
      throw err;
    }
  }

  const advanceCovered = Number(loan.fundingAdvanceAmount || 0);
  const reserveCovered = Number(loan.fundingReserveAmount || 0);
  let persistedSource = requestedSource;
  if (requestedSource === 'reserve') {
    persistedSource = 'reserve';
  } else if (advanceCovered > 0.001 && reserveCovered > 0.001) {
    persistedSource = 'mixed';
  } else if (advanceCovered > 0.001) {
    persistedSource = advanceCovered + 0.001 >= amount ? 'advance' : 'mixed';
  } else if (reserveCovered > 0.001) {
    persistedSource = 'mixed';
  } else {
    persistedSource = 'bank';
  }

  const fundingNote = persistedSource === 'reserve'
    ? 'Funded from Emergency / Reserve Fund'
    : persistedSource === 'advance'
      ? `Funded via internal borrow${loan.fundingLenderName ? ` from ${loan.fundingLenderName}` : ''}`
      : persistedSource === 'mixed'
        ? `Mixed funding${advanceCovered > 0 ? ` · advance ${formatMoney(advanceCovered, 2)}` : ''}${reserveCovered > 0 ? ` · reserve ${formatMoney(reserveCovered, 2)}` : ''}`
        : 'Funded from society book balance';

  loan.status = 'disbursed';
  loan.paymentMethod = normalizedPaymentMethod;
  loan.disbursedAt = new Date();
  loan.disbursedBy = disbursedBy?.trim() || 'Admin';
  loan.disbursementReference = transferReference?.trim() || '';
  loan.disbursementNote = [
    disbursementNote?.trim() || '',
    fundingNote,
  ].filter(Boolean).join(' · ');
  loan.fundingSource = persistedSource;
  loan.outstandingBalance = amount;
  loan.totalRepaid = 0;
  loan.repaymentStatus = 'active';
  if (!loan.installmentMonths) {
    loan.installmentMonths = 12;
  }
  await loan.save();

  const member = loan.member;
  const paymentLabel = formatPaymentMethodLabel(loan.paymentMethod);
  const referenceNote = loan.disbursementReference ? ` Reference: ${loan.disbursementReference}.` : '';
  const sourceLabel = resolveLoanFundingSourceLabel(loan);
  const sourceNote = persistedSource === 'bank' ? '' : ` (${sourceLabel})`;
  const transferMessage = `Dear ${member.name}, your ${loan.loanType} loan of ${formatMoney(Number(loan.amount), 2)} has been transferred to you via ${paymentLabel}${sourceNote}.${referenceNote}`;

  if (member?.email) {
    await sendTransactionalEmail({
      to: member.email,
      subject: 'Loan Money Transferred',
      text: transferMessage,
      html: `<p>Dear ${member.name},</p><p>Your <strong>${loan.loanType}</strong> loan of <strong>${formatMoney(Number(loan.amount), 2)}</strong> has been transferred to you.</p><p><strong>Method:</strong> ${paymentLabel}</p><p><strong>Funding:</strong> ${sourceLabel}</p>${loan.disbursementReference ? `<p><strong>Reference:</strong> ${loan.disbursementReference}</p>` : ''}${loan.disbursementNote ? `<p><strong>Note:</strong> ${loan.disbursementNote}</p>` : ''}<p>Please check your member dashboard for full transfer details.</p>`,
    });
  }

  if (member?.phone) {
    await sendSms({
      to: member.phone,
      message: `Loan transferred: ${formatMoney(Number(loan.amount), 2)} via ${paymentLabel}${sourceNote}.${referenceNote}`,
    });
  }

  await createMemberNotification({
    memberId: loan.member._id || loan.member,
    type: 'loan',
    title: 'Loan Money Transferred',
    message: `Your ${loan.loanType} loan of ${formatMoney(Number(loan.amount), 2)} was transferred via ${paymentLabel}${sourceNote}.${referenceNote}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  return {
    loan,
    fundingSource: persistedSource,
    fundingSourceLabel: sourceLabel,
    reserveBalance: reserveResult?.balance ?? null,
    bookBalance: ledgerResult?.ledger?.bookBalance ?? null,
  };
}

module.exports = {
  LOAN_LIMIT_RATIO,
  PAYMENT_METHODS,
  calculateLoanEligibility,
  getGeneralLoanUsage,
  buildMemberLoanEligibility,
  getLoanEligibility,
  createLoanApplication,
  getLoanApplicationsForMember,
  getLoanApplicationsForAdmin,
  getLoanApplicationById,
  getLoansByMemberId,
  getMemberLoanDashboardSummary,
  getLoanContractFile,
  uploadSignedLoanContract,
  updateLoanApplicationStatus,
  getLoanDisbursementFundingSnapshot,
  previewLoanDisbursement,
  coverLoanDisbursementFromAdvance,
  coverLoanDisbursementFromReserve,
  resolveLoanFundingSourceLabel,
  disburseLoanApplication,
  formatPaymentMethodLabel,
  getAllLoanTakers,
  getActiveBorrowers,
  getLoanPortfolioSummary,
};
