const { formatMoney } = require('./moneyFormat');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const { sendTransactionalEmail, generateLoanContractPdf, formatPaymentMethodLabel } = require('./notificationService');
const { sendSms } = require('./smsService');
const {
  withMongoTransaction,
  bindSession,
  sessionOpt,
  createWithSession,
} = require('./mongoTransaction');

const LOAN_LIMIT_RATIO = 0.8;
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'mobile_banking', 'check', 'other'];

/** CEO PATCH may only move pending→approved|rejected, or approved→rejected. */
const CEO_LOAN_STATUS_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['rejected'],
};

function money2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function httpLoanError(message, status = 400, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

async function getMemberTotalDepositAmount(memberId) {
  const Deposit = require('../models/Deposit');
  const rows = await Deposit.find({ member: memberId }).select('amount').lean();
  return Number(
    rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)
  );
}

/** Parse amounts that may use comma decimals (e.g. 17716,67) or thousand separators. */
function parseLooseMoney(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return Number(Number(value).toFixed(2));
  let raw = String(value).trim();
  if (!raw) return NaN;
  raw = raw.replace(/[^\d,.-]/g, '');
  if (raw.includes(',') && raw.includes('.')) {
    // Assume the last separator is the decimal mark.
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (raw.includes(',')) {
    raw = raw.replace(',', '.');
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Number(n.toFixed(2));
}

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

/**
 * Max general loan = 80% of the member's lifetime total deposit amount
 * (not current savings balance).
 */
function calculateLoanEligibility(totalDepositAmount = 0) {
  const normalizedDeposits = Number(totalDepositAmount) || 0;
  const maxEligibleAmount = Number((normalizedDeposits * LOAN_LIMIT_RATIO).toFixed(2));
  return {
    totalDepositAmount: normalizedDeposits,
    // Backward-compatible alias: older clients read totalSavings as the 80% base.
    totalSavings: normalizedDeposits,
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

async function buildMemberLoanEligibility(member, { excludeLoanId = null } = {}) {
  const totalDepositAmount = await getMemberTotalDepositAmount(member._id);
  const baseEligibility = calculateLoanEligibility(totalDepositAmount);
  const usedGeneralLoanAmount = await getGeneralLoanUsage(member._id, excludeLoanId);
  const availableMaxLoan = Math.max(
    0,
    Number((baseEligibility.maxEligibleAmount - usedGeneralLoanAmount).toFixed(2))
  );

  return {
    totalDepositAmount,
    totalSavings: totalDepositAmount,
    memberSavingsBalance: Number(member.savings || 0),
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

function exceedsLoanLimit(amount, totalDepositAmount, loanType = 'general', availableMaxLoan = null) {
  if (loanType === 'emergency') {
    return false;
  }
  if (availableMaxLoan !== null && availableMaxLoan !== undefined) {
    return exceedsAvailableGeneralLoan(amount, availableMaxLoan);
  }
  const normalizedAmount = Number(amount) || 0;
  const { maxEligibleAmount } = calculateLoanEligibility(totalDepositAmount);
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

  const normalizedAmount = money2(parseLooseMoney(amount));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
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

  let loan;
  try {
    loan = await LoanApplication.create({
      member: memberId,
      amount: normalizedAmount,
      loanType: normalizedType,
      reason: reason.trim(),
      witnessName: witnessName.trim(),
      witnessPhone: witnessPhone.trim(),
      witnessRelation: witnessRelation?.trim() || '',
      documents,
      memberSavingsAtApply: eligibility.totalDepositAmount,
      maxEligibleAmount: normalizedType === 'general' ? eligibility.theoreticalMaxLoan : 0,
      status: isOverLimit ? 'rejected' : 'pending',
      autoRejected: isOverLimit,
      rejectionReason: isOverLimit
        ? `Loan amount exceeds remaining general loan limit. Available: ${formatMoney(eligibility.availableMaxLoan, 2)} (80% of total deposits minus active general loans).`
        : '',
      adminNote: isOverLimit
        ? 'Automatically rejected because requested amount is above the remaining 80% total-deposit loan limit.'
        : '',
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw httpLoanError('You already have a pending or approved loan application.', 400);
    }
    throw error;
  }

  if (isOverLimit) {
    if (member.email) {
      await sendTransactionalEmail({
        to: member.email,
        subject: 'Loan Application Auto-Rejected',
        text: `Dear ${member.name}, your ${normalizedType} loan application for ${formatMoney(normalizedAmount, 2)} was automatically rejected. Remaining general loan limit: ${formatMoney(eligibility.availableMaxLoan, 2)} (total 80% of deposits cap: ${formatMoney(eligibility.theoreticalMaxLoan, 2)}, already used: ${formatMoney(eligibility.usedGeneralLoanAmount, 2)}).`,
        html: `<p>Dear ${member.name},</p><p>Your <strong>${normalizedType}</strong> loan application for <strong>${formatMoney(normalizedAmount, 2)}</strong> was automatically rejected because it exceeds your <strong>remaining</strong> general loan limit.</p><p>Total deposit amount: ${formatMoney(eligibility.totalDepositAmount, 2)}<br>80% cap: ${formatMoney(eligibility.theoreticalMaxLoan, 2)}<br>Already reserved in general loans: ${formatMoney(eligibility.usedGeneralLoanAmount, 2)}<br>Available now: ${formatMoney(eligibility.availableMaxLoan, 2)}</p>`,
      });
    }

    if (member.phone) {
      await sendSms({
        to: member.phone,
        message: `Loan auto-rejected: exceeds remaining limit. Available: ${formatMoney(eligibility.availableMaxLoan, 2)}.`,
      });
    }

    return { loan, autoRejected: true };
  }

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

async function getLoanContractFile(loanId, { regenerateIfMissing = true } = {}) {
  let loan = await LoanApplication.findById(loanId)
    .populate({ path: 'member', select: 'name email phone savings' });

  if (!loan) {
    const error = new Error('Loan application not found.');
    error.status = 404;
    throw error;
  }

  const resolveExistingPath = (doc) => {
    if (!doc?.contractPath) return null;
    const relativePath = String(doc.contractPath).replace(/^\/uploads\//, '');
    const fullPath = path.join(__dirname, '..', 'uploads', relativePath);
    return fs.existsSync(fullPath) ? fullPath : null;
  };

  let fullPath = resolveExistingPath(loan);
  if (fullPath) {
    return { loan: loan.toObject ? loan.toObject() : loan, fullPath };
  }

  const canRegenerate = regenerateIfMissing
    && ['approved', 'disbursed', 'completed'].includes(loan.status)
    && !loan.autoRejected;

  if (!canRegenerate) {
    const error = new Error(
      loan.contractPath
        ? 'Contract file is missing and this loan cannot regenerate a contract.'
        : 'Loan contract not found.'
    );
    error.status = 404;
    throw error;
  }

  // Hostinger redeploys / missing uploads: rebuild the PDF from current loan data.
  try {
    const member = loan.member
      || await User.findById(loan.member).select('name email phone savings');
    if (!member) {
      const error = new Error('Loan member not found; unable to regenerate contract.');
      error.status = 404;
      throw error;
    }
    await generateLoanContractForApplication(
      loan,
      member,
      loan.reviewedBy || loan.disbursedBy || 'Admin'
    );
    await loan.save();
  } catch (error) {
    if (error.status) throw error;
    const err = new Error(error.message || 'Unable to regenerate loan contract PDF.');
    err.status = 500;
    throw err;
  }

  fullPath = resolveExistingPath(loan);
  if (!fullPath) {
    const error = new Error('Contract file is missing after regeneration.');
    error.status = 500;
    throw error;
  }

  return { loan: loan.toObject ? loan.toObject() : loan, fullPath };
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

/**
 * Release pre-disburse advance/reserve allocations when an approved loan is rejected
 * (or funding is otherwise abandoned) so lender advance and reserve are not orphaned.
 */
async function releaseLoanDisbursementFunding(loan, reviewedBy = 'Admin', session = null) {
  const InternalBorrowing = require('../models/InternalBorrowing');
  const { creditReserve } = require('./emergencyReserveService');

  const openBorrowings = await bindSession(
    InternalBorrowing.find({
      loan: loan._id,
      status: { $in: ['open', 'partial'] },
    }),
    session
  );

  for (const borrowing of openBorrowings) {
    const outstanding = money2(
      Number(borrowing.amount || 0) - Number(borrowing.amountSettled || 0)
    );
    if (outstanding > 0.001) {
      const refunded = await User.findOneAndUpdate(
        { _id: borrowing.lender },
        { $inc: { advanceBalance: outstanding } },
        sessionOpt(session, { new: true })
      );
      if (!refunded) {
        throw httpLoanError('Unable to restore lender advance while releasing loan funding.', 409);
      }
    }
    borrowing.status = 'cancelled';
    borrowing.note = [
      borrowing.note || '',
      `Cancelled — loan funding released by ${reviewedBy}`,
    ].filter(Boolean).join(' · ');
    await borrowing.save(sessionOpt(session));
  }

  const reserveAllocated = money2(loan.fundingReserveAmount || 0);
  if (reserveAllocated > 0.001) {
    await creditReserve(reserveAllocated, {
      type: 'adjustment',
      note: `Released unused loan reserve funding · loan ${loan._id}`,
      createdBy: reviewedBy,
      referenceType: 'LoanApplication',
      referenceId: loan._id,
      session,
    });
  }

  await LoanApplication.updateOne(
    { _id: loan._id },
    {
      $set: {
        fundingAdvanceAmount: 0,
        fundingReserveAmount: 0,
        fundingReserveOutstanding: 0,
        fundingLenderName: '',
        fundingSource: '',
        updatedAt: new Date(),
      },
    },
    sessionOpt(session)
  );

  loan.fundingAdvanceAmount = 0;
  loan.fundingReserveAmount = 0;
  loan.fundingReserveOutstanding = 0;
  loan.fundingLenderName = '';
  loan.fundingSource = '';
}

async function updateLoanApplicationStatus(loanId, status, adminNote = '', reviewedBy = 'Admin', paymentMethod = '') {
  if (status === 'disbursed') {
    throw httpLoanError('Use the loan disbursement transfer action to send money to the member.');
  }
  if (!['approved', 'rejected'].includes(status)) {
    throw httpLoanError(
      'Invalid loan status. CEO may only approve or reject pending applications (or reject approved ones before disbursement).'
    );
  }

  const loan = await LoanApplication.findById(loanId).populate({ path: 'member', select: 'name email phone savings' });
  if (!loan) {
    throw httpLoanError('Loan application not found.', 404);
  }

  if (loan.autoRejected) {
    throw httpLoanError('This application was auto-rejected and cannot be updated.');
  }

  if (['disbursed', 'completed'].includes(loan.status)) {
    throw httpLoanError(
      `Cannot change a ${loan.status} loan via CEO review. Disbursed loans are managed through repayment.`,
      400
    );
  }

  const allowedTargets = CEO_LOAN_STATUS_TRANSITIONS[loan.status] || [];
  if (!allowedTargets.includes(status)) {
    throw httpLoanError(
      `Cannot move loan from "${loan.status}" to "${status}". Allowed: ${allowedTargets.join(', ') || 'none'}.`
    );
  }

  if (status === 'approved') {
    if (loan.loanType === 'general') {
      const eligibility = await buildMemberLoanEligibility(loan.member, { excludeLoanId: loan._id });
      if (exceedsAvailableGeneralLoan(loan.amount, eligibility.availableMaxLoan)) {
        throw httpLoanError(
          `Cannot approve: loan amount exceeds remaining general loan limit (${formatMoney(eligibility.availableMaxLoan, 2)}).`
        );
      }
    }
    const normalizedPaymentMethod = paymentMethod?.trim() || loan.paymentMethod || '';
    if (!PAYMENT_METHODS.includes(normalizedPaymentMethod)) {
      throw httpLoanError('Payment method is required when approving a loan.');
    }
    loan.paymentMethod = normalizedPaymentMethod;
    if (!loan.contractPath) {
      await generateLoanContractForApplication(loan, loan.member, reviewedBy);
    }
  }

  const fromStatuses = status === 'approved' ? ['pending'] : ['pending', 'approved'];
  const setFields = {
    status,
    adminNote: adminNote?.trim() || loan.adminNote || '',
    reviewedBy: reviewedBy?.trim() || 'Admin',
    updatedAt: new Date(),
  };
  if (status === 'approved') {
    setFields.paymentMethod = loan.paymentMethod;
    setFields.approvedAt = new Date();
    if (loan.contractPath) setFields.contractPath = loan.contractPath;
    if (loan.contractGeneratedAt) setFields.contractGeneratedAt = loan.contractGeneratedAt;
  }
  if (status === 'rejected' && adminNote?.trim()) {
    setFields.rejectionReason = adminNote.trim();
  }

  const claimed = await withMongoTransaction(async (session) => {
    if (status === 'rejected' && loan.status === 'approved') {
      const funded = money2(loan.fundingAdvanceAmount || 0) + money2(loan.fundingReserveAmount || 0);
      if (funded > 0.001) {
        await releaseLoanDisbursementFunding(loan, reviewedBy, session);
      }
    }

    const updated = await LoanApplication.findOneAndUpdate(
      {
        _id: loan._id,
        status: { $in: fromStatuses },
        autoRejected: { $ne: true },
      },
      { $set: setFields },
      sessionOpt(session, { new: true })
    );
    if (!updated) {
      throw httpLoanError(
        'Loan status changed concurrently. Refresh and try again.',
        409
      );
    }
    return updated;
  });

  claimed.member = loan.member;
  Object.assign(loan, claimed.toObject?.() || claimed);

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

  return loan;
}

/**
 * Loan funding snapshot — loans are funded only via member advance (internal borrow)
 * and/or Emergency / Reserve Fund. Society book balance is never used for loan payout.
 */
async function getLoanDisbursementFundingSnapshot(loan) {
  const requiredAmount = Number(Number(loan.amount || 0).toFixed(2));
  const [{ ensureFund, money: reserveMoney }, { listMemberAdvanceBalances }] = await Promise.all([
    Promise.resolve(require('./emergencyReserveService')),
    Promise.resolve(require('./advanceBorrowingService')),
  ]);

  const fund = await ensureFund();
  const reserveBalance = reserveMoney(fund.balance);
  const advances = (await listMemberAdvanceBalances())
    .filter((m) => Number(m.advanceBalance || 0) > 0.001)
    .sort((a, b) => Number(b.advanceBalance || 0) - Number(a.advanceBalance || 0));

  const fundedAdvance = Number(Number(loan.fundingAdvanceAmount || 0).toFixed(2));
  const fundedReserve = Number(Number(loan.fundingReserveAmount || 0).toFixed(2));
  const fundedAmount = Number((fundedAdvance + fundedReserve).toFixed(2));
  const remainingToFund = Number(Math.max(0, requiredAmount - fundedAmount).toFixed(2));
  const totalAdvanceAvailable = Number(
    advances.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0).toFixed(2)
  );
  const fullyFunded = remainingToFund <= 0.001;

  return {
    loanId: loan._id,
    status: loan.status,
    requiredAmount,
    fundedAmount,
    fundedAdvance,
    fundedReserve,
    remainingToFund,
    // Alias kept for older modal clients — means "amount still to fund", not book shortfall.
    shortfall: remainingToFund,
    hasShortfall: remainingToFund > 0.001,
    canComplete: fullyFunded,
    canCompleteDirectly: fullyFunded,
    canDisburseDirectly: fullyFunded,
    // Always show the funding modal so cashiers pick advance and/or reserve explicitly.
    needsPopup: true,
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
      maxCoverable: Number(Math.min(remainingToFund, reserveBalance + totalAdvanceAvailable).toFixed(2)),
    },
  };
}

/**
 * Pre-flight check before loan Disburse — used by the funding selection modal.
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
    message = `Loan is fully funded (${formatMoney(funding.fundedAmount, 2)}) from advance and/or Emergency / Reserve Fund. Confirm to disburse.`;
  } else if (funding.hasShortfall) {
    message = `Fund ${formatMoney(funding.remainingToFund, 2)} from member advance (internal borrow) and/or Emergency / Reserve Fund before disbursing. Loans do not use society book balance.`;
  } else {
    message = 'Select advance and/or Emergency / Reserve Fund to finance this loan.';
  }

  return {
    ...funding,
    message,
  };
}

/**
 * Allocate loan funding from a member's advance (internal borrow).
 * Debits lender advance and opens InternalBorrowing — does NOT touch society book balance.
 */
async function coverLoanDisbursementFromAdvance({
  loanId,
  lenderId,
  amount,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  return withMongoTransaction(async (session) => {
    const loan = await bindSession(
      LoanApplication.findById(loanId).populate('member', 'name email'),
      session
    );
    if (!loan) {
      throw httpLoanError('Loan application not found.', 404);
    }
    if (loan.status !== 'approved') {
      throw httpLoanError('Only approved loans can receive disbursement funding.');
    }

    const snapshot = await getLoanDisbursementFundingSnapshot(loan);
    if (!(snapshot.remainingToFund > 0.001)) {
      throw httpLoanError('This loan is already fully funded. You can disburse it now.', 400, {
        funding: snapshot,
      });
    }

    const payAmount = amount == null || amount === ''
      ? snapshot.remainingToFund
      : parseLooseMoney(amount);
    if (!(payAmount > 0)) {
      throw httpLoanError('Funding amount must be greater than zero.');
    }
    if (payAmount > snapshot.remainingToFund + 0.001) {
      throw httpLoanError(
        `Amount exceeds remaining to fund of ${formatMoney(snapshot.remainingToFund, 2)}.`
      );
    }

    const lender = await bindSession(
      User.findOne({ _id: lenderId, role: 'member', status: 'active' }),
      session
    );
    if (!lender) {
      throw httpLoanError('Lender member not found or inactive.', 404);
    }

    const updatedLender = await User.findOneAndUpdate(
      {
        _id: lender._id,
        role: 'member',
        status: 'active',
        advanceBalance: { $gte: money2(payAmount - 0.001) },
      },
      { $inc: { advanceBalance: -payAmount } },
      sessionOpt(session, { new: true })
    );
    if (!updatedLender) {
      const advanceAvail = money2(lender.advanceBalance || 0);
      throw httpLoanError(
        `Lender advance balance insufficient. Available: ${formatMoney(advanceAvail, 2)}.`
      );
    }

    const borrowerId = loan.member?._id || loan.member;
    const InternalBorrowing = require('../models/InternalBorrowing');
    const borrowing = await createWithSession(InternalBorrowing, {
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
        || `Internal borrow from ${lender.name} advance to fund loan disbursement for ${loan.member?.name || 'member'}`,
      createdBy: String(createdBy || 'Cashier').trim(),
    }, session);

    const fundingLenderName = !loan.fundingLenderName
      ? lender.name
      : (String(loan.fundingLenderName).includes(lender.name)
        ? loan.fundingLenderName
        : `${loan.fundingLenderName}, ${lender.name}`);

    const updatedLoan = await LoanApplication.findOneAndUpdate(
      {
        _id: loan._id,
        status: 'approved',
        $expr: {
          $lte: [
            {
              $add: [
                { $ifNull: ['$fundingAdvanceAmount', 0] },
                { $ifNull: ['$fundingReserveAmount', 0] },
                payAmount,
              ],
            },
            { $add: ['$amount', 0.001] },
          ],
        },
      },
      {
        $inc: { fundingAdvanceAmount: payAmount },
        $set: {
          fundingLenderName,
          updatedAt: new Date(),
        },
      },
      sessionOpt(session, { new: true })
    );
    if (!updatedLoan) {
      throw httpLoanError(
        'Unable to allocate advance funding (loan changed or would exceed amount). Refresh and retry.',
        409
      );
    }
    updatedLoan.member = loan.member;

    const funding = await getLoanDisbursementFundingSnapshot(updatedLoan);
    return {
      mode: 'advance',
      borrowing,
      amountCovered: payAmount,
      funding,
      message: `Allocated ${formatMoney(payAmount, 2)} from ${lender.name}'s advance. Funded ${formatMoney(funding.fundedAmount, 2)} of ${formatMoney(funding.requiredAmount, 2)}. Remaining: ${formatMoney(funding.remainingToFund, 2)}.`,
    };
  });
}

/**
 * Allocate loan funding from Emergency / Reserve Fund.
 * Debits reserve only — does NOT credit or debit society book balance.
 */
async function coverLoanDisbursementFromReserve({
  loanId,
  amount,
  createdBy = 'Cashier',
  note = '',
} = {}) {
  return withMongoTransaction(async (session) => {
    const loan = await bindSession(
      LoanApplication.findById(loanId).populate('member', 'name email'),
      session
    );
    if (!loan) {
      throw httpLoanError('Loan application not found.', 404);
    }
    if (loan.status !== 'approved') {
      throw httpLoanError('Only approved loans can receive disbursement funding.');
    }

    const snapshot = await getLoanDisbursementFundingSnapshot(loan);
    if (!(snapshot.remainingToFund > 0.001)) {
      throw httpLoanError('This loan is already fully funded. You can disburse it now.', 400, {
        funding: snapshot,
      });
    }

    const payAmount = amount == null || amount === ''
      ? Math.min(snapshot.remainingToFund, snapshot.reserveBalance)
      : parseLooseMoney(amount);
    if (!(payAmount > 0)) {
      throw httpLoanError('Funding amount must be greater than zero.');
    }
    if (payAmount > snapshot.remainingToFund + 0.001) {
      throw httpLoanError(
        `Amount exceeds remaining to fund of ${formatMoney(snapshot.remainingToFund, 2)}.`
      );
    }
    if (payAmount > snapshot.reserveBalance + 0.001) {
      throw httpLoanError(
        `Emergency reserve has only ${formatMoney(snapshot.reserveBalance, 2)} available.`
      );
    }

    const { debitReserve } = require('./emergencyReserveService');
    const reserveResult = await debitReserve(payAmount, {
      type: 'loan_cover',
      note: note?.trim()
        || `Emergency/Reserve allocated to fund loan disbursement · ${loan.member?.name || 'member'}`,
      createdBy,
      referenceType: 'LoanApplication',
      referenceId: loan._id,
      session,
    });

    const updatedLoan = await LoanApplication.findOneAndUpdate(
      {
        _id: loan._id,
        status: 'approved',
        $expr: {
          $lte: [
            {
              $add: [
                { $ifNull: ['$fundingAdvanceAmount', 0] },
                { $ifNull: ['$fundingReserveAmount', 0] },
                payAmount,
              ],
            },
            { $add: ['$amount', 0.001] },
          ],
        },
      },
      {
        $inc: {
          fundingReserveAmount: payAmount,
          fundingReserveOutstanding: payAmount,
        },
        $set: { updatedAt: new Date() },
      },
      sessionOpt(session, { new: true })
    );
    if (!updatedLoan) {
      throw httpLoanError(
        'Unable to allocate reserve funding (loan changed or would exceed amount). Refresh and retry.',
        409
      );
    }
    updatedLoan.member = loan.member;

    const funding = await getLoanDisbursementFundingSnapshot(updatedLoan);
    return {
      mode: 'reserve',
      reserve: {
        balance: reserveResult.balance,
        entry: reserveResult.entry,
      },
      amountCovered: payAmount,
      funding,
      message: `Allocated ${formatMoney(payAmount, 2)} from Emergency / Reserve Fund. Funded ${formatMoney(funding.fundedAmount, 2)} of ${formatMoney(funding.requiredAmount, 2)}. Remaining: ${formatMoney(funding.remainingToFund, 2)}.`,
    };
  });
}

function resolveLoanFundingSourceLabel(loan) {
  const source = String(loan.fundingSource || '').toLowerCase();
  if (source === 'reserve') return 'Emergency / Reserve Fund';
  if (source === 'advance') return 'Internal borrow (member advance)';
  if (source === 'mixed') {
    const parts = [];
    if (Number(loan.fundingAdvanceAmount || 0) > 0) parts.push('member advance');
    if (Number(loan.fundingReserveAmount || 0) > 0) parts.push('Emergency / Reserve Fund');
    return parts.length ? `Mixed (${parts.join(' + ')})` : 'Mixed external funding';
  }
  if (source === 'bank') return 'Society book balance (legacy)';
  // Unpersisted / in-progress loans: describe from amounts when possible.
  const advance = Number(loan.fundingAdvanceAmount || 0);
  const reserve = Number(loan.fundingReserveAmount || 0);
  if (advance > 0.001 && reserve > 0.001) return 'Mixed (member advance + Emergency / Reserve Fund)';
  if (advance > 0.001) return 'Internal borrow (member advance)';
  if (reserve > 0.001) return 'Emergency / Reserve Fund';
  return 'External funding (advance or Emergency / Reserve Fund)';
}

/**
 * Finalize loan disbursement after advance and/or reserve funding is fully allocated.
 * Atomic approved→disbursed claim inside withMongoTransaction. Does not touch society book balance.
 */
async function disburseLoanApplication(loanId, {
  paymentMethod = '',
  transferReference = '',
  disbursementNote = '',
  disbursedBy = 'Admin',
  fundingSource = '',
} = {}) {
  const loan = await LoanApplication.findById(loanId).populate({ path: 'member', select: 'name email phone savings' });
  if (!loan) {
    throw httpLoanError('Loan application not found.', 404);
  }

  if (loan.autoRejected) {
    throw httpLoanError('This application was auto-rejected and cannot be disbursed.');
  }

  if (loan.status !== 'approved') {
    throw httpLoanError('Only approved loans can be disbursed. Approve the loan first.');
  }

  const normalizedPaymentMethod = paymentMethod?.trim() || loan.paymentMethod || '';
  if (!PAYMENT_METHODS.includes(normalizedPaymentMethod)) {
    throw httpLoanError('Transfer method is required to disburse the loan.');
  }

  const requested = String(fundingSource || '').toLowerCase();
  if (requested === 'bank') {
    const funding = await getLoanDisbursementFundingSnapshot(loan);
    throw httpLoanError(
      'Loans cannot be funded from society book balance. Fund via member advance or Emergency / Reserve Fund in the disbursement popup.',
      409,
      {
        funding: {
          ...funding,
          needsPopup: true,
          message: 'Loans cannot be funded from society book balance. Fund via member advance or Emergency / Reserve Fund in the disbursement popup.',
        },
      }
    );
  }

  // Optional convenience: allocate remaining from reserve before the atomic claim.
  let funding = await getLoanDisbursementFundingSnapshot(loan);
  if (requested === 'reserve' && funding.remainingToFund > 0.001) {
    await coverLoanDisbursementFromReserve({
      loanId: loan._id,
      amount: funding.remainingToFund,
      createdBy: disbursedBy,
      note: `Full remaining reserve allocation at disbursement · ${loan.member?.name || 'member'}`,
    });
  }

  const result = await withMongoTransaction(async (session) => {
    const workingLoan = await bindSession(
      LoanApplication.findById(loanId).populate({ path: 'member', select: 'name email phone savings' }),
      session
    );
    if (!workingLoan) {
      throw httpLoanError('Loan application not found.', 404);
    }
    if (workingLoan.status !== 'approved') {
      throw httpLoanError('Only approved loans can be disbursed. Approve the loan first.');
    }

    funding = await getLoanDisbursementFundingSnapshot(workingLoan);
    if (!funding.canDisburseDirectly || funding.remainingToFund > 0.001) {
      throw httpLoanError(
        `Loan is not fully funded. Allocate ${formatMoney(funding.remainingToFund, 2)} from member advance or Emergency / Reserve Fund before disbursing.`,
        409,
        {
          funding: {
            ...funding,
            needsPopup: true,
            message: `Loan is not fully funded. Allocate ${formatMoney(funding.remainingToFund, 2)} from member advance or Emergency / Reserve Fund before disbursing.`,
          },
        }
      );
    }

    const amount = money2(workingLoan.amount || 0);
    const advanceCovered = money2(workingLoan.fundingAdvanceAmount || 0);
    const reserveCovered = money2(workingLoan.fundingReserveAmount || 0);
    let persistedSource = 'advance';
    if (advanceCovered > 0.001 && reserveCovered > 0.001) {
      persistedSource = 'mixed';
    } else if (reserveCovered > 0.001 && !(advanceCovered > 0.001)) {
      persistedSource = 'reserve';
    } else if (advanceCovered > 0.001) {
      persistedSource = 'advance';
    } else {
      throw httpLoanError(
        'Loan funding is incomplete. Allocate from member advance or Emergency / Reserve Fund first.',
        409,
        { funding: { ...funding, needsPopup: true, message: 'Loan funding is incomplete. Allocate from member advance or Emergency / Reserve Fund first.' } }
      );
    }

    const fundingNote = persistedSource === 'reserve'
      ? 'Funded from Emergency / Reserve Fund'
      : persistedSource === 'advance'
        ? `Funded via internal borrow${workingLoan.fundingLenderName ? ` from ${workingLoan.fundingLenderName}` : ''}`
        : `Mixed funding · advance ${formatMoney(advanceCovered, 2)} · reserve ${formatMoney(reserveCovered, 2)}`;

    const disbursementNoteCombined = [
      disbursementNote?.trim() || '',
      fundingNote,
    ].filter(Boolean).join(' · ');

    // Atomic claim: only one concurrent disburse can win.
    const claimed = await LoanApplication.findOneAndUpdate(
      {
        _id: workingLoan._id,
        status: 'approved',
        $expr: {
          $lte: [
            {
              $subtract: [
                '$amount',
                {
                  $add: [
                    { $ifNull: ['$fundingAdvanceAmount', 0] },
                    { $ifNull: ['$fundingReserveAmount', 0] },
                  ],
                },
              ],
            },
            0.001,
          ],
        },
      },
      {
        $set: {
          status: 'disbursed',
          paymentMethod: normalizedPaymentMethod,
          disbursedAt: new Date(),
          disbursedBy: disbursedBy?.trim() || 'Admin',
          disbursementReference: transferReference?.trim() || '',
          disbursementNote: disbursementNoteCombined,
          fundingSource: persistedSource,
          outstandingBalance: amount,
          totalRepaid: 0,
          repaymentStatus: 'active',
          updatedAt: new Date(),
        },
      },
      sessionOpt(session, { new: true })
    );

    if (!claimed) {
      throw httpLoanError(
        'Loan was already disbursed or funding changed. Refresh the queue and try again.',
        409
      );
    }
    claimed.member = workingLoan.member;

    const { ensureFund, money: reserveMoney } = require('./emergencyReserveService');
    const fund = await ensureFund(session);
    const reserveBalance = reserveMoney(fund.balance);

    return {
      loan: claimed,
      fundingSource: persistedSource,
      fundingSourceLabel: resolveLoanFundingSourceLabel(claimed),
      reserveBalance,
      bookBalance: null,
    };
  });

  const workingLoan = result.loan;
  const member = workingLoan.member;
  const paymentLabel = formatPaymentMethodLabel(workingLoan.paymentMethod);
  const referenceNote = workingLoan.disbursementReference ? ` Reference: ${workingLoan.disbursementReference}.` : '';
  const sourceLabel = result.fundingSourceLabel;
  const sourceNote = ` (${sourceLabel})`;
  const transferMessage = `Dear ${member.name}, your ${workingLoan.loanType} loan of ${formatMoney(Number(workingLoan.amount), 2)} has been transferred to you via ${paymentLabel}${sourceNote}.${referenceNote}`;

  if (member?.email) {
    await sendTransactionalEmail({
      to: member.email,
      subject: 'Loan Money Transferred',
      text: transferMessage,
      html: `<p>Dear ${member.name},</p><p>Your <strong>${workingLoan.loanType}</strong> loan of <strong>${formatMoney(Number(workingLoan.amount), 2)}</strong> has been transferred to you.</p><p><strong>Method:</strong> ${paymentLabel}</p><p><strong>Funding:</strong> ${sourceLabel}</p>${workingLoan.disbursementReference ? `<p><strong>Reference:</strong> ${workingLoan.disbursementReference}</p>` : ''}${workingLoan.disbursementNote ? `<p><strong>Note:</strong> ${workingLoan.disbursementNote}</p>` : ''}<p>Please check your member dashboard for full transfer details.</p>`,
    });
  }

  if (member?.phone) {
    await sendSms({
      to: member.phone,
      message: `Loan transferred: ${formatMoney(Number(workingLoan.amount), 2)} via ${paymentLabel}${sourceNote}.${referenceNote}`,
    });
  }

  return result;
}


module.exports = {
  LOAN_LIMIT_RATIO,
  PAYMENT_METHODS,
  calculateLoanEligibility,
  getMemberTotalDepositAmount,
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
  releaseLoanDisbursementFunding,
  resolveLoanFundingSourceLabel,
  parseLooseMoney,
  disburseLoanApplication,
  formatPaymentMethodLabel,
  getAllLoanTakers,
  getActiveBorrowers,
  getLoanPortfolioSummary,
};
