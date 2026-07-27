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
      ? `Loan amount exceeds remaining general loan limit. Available: $${eligibility.availableMaxLoan.toFixed(2)} (80% savings limit minus active general loans).`
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
        text: `Dear ${member.name}, your ${normalizedType} loan application for $${normalizedAmount.toFixed(2)} was automatically rejected. Remaining general loan limit: $${eligibility.availableMaxLoan.toFixed(2)} (total 80% cap: $${eligibility.theoreticalMaxLoan.toFixed(2)}, already used: $${eligibility.usedGeneralLoanAmount.toFixed(2)}).`,
        html: `<p>Dear ${member.name},</p><p>Your <strong>${normalizedType}</strong> loan application for <strong>$${normalizedAmount.toFixed(2)}</strong> was automatically rejected because it exceeds your <strong>remaining</strong> general loan limit.</p><p>Total savings: $${eligibility.totalSavings.toFixed(2)}<br>80% cap: $${eligibility.theoreticalMaxLoan.toFixed(2)}<br>Already reserved in general loans: $${eligibility.usedGeneralLoanAmount.toFixed(2)}<br>Available now: $${eligibility.availableMaxLoan.toFixed(2)}</p>`,
      });
    }

    if (member.phone) {
      await sendSms({
        to: member.phone,
        message: `Loan auto-rejected: exceeds remaining limit. Available: $${eligibility.availableMaxLoan.toFixed(2)}.`,
      });
    }

    await createMemberNotification({
      memberId,
      type: 'loan',
      title: 'Loan Application Auto-Rejected',
      message: `Your ${normalizedType} loan application for $${normalizedAmount.toFixed(2)} was auto-rejected.`,
      relatedId: loan._id,
      relatedModel: 'LoanApplication',
    });

    return { loan, autoRejected: true };
  }

  await createMemberNotification({
    memberId,
    type: 'loan',
    title: 'Loan Application Submitted',
    message: `Your ${normalizedType} loan application for $${normalizedAmount.toFixed(2)} was submitted and is awaiting admin review.`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  await createAdminNotification({
    type: 'loan',
    title: `New ${normalizedType === 'emergency' ? 'Emergency ' : ''}Loan Application from ${member.name}`,
    message: `${member.name} requested a ${normalizedType} loan of $${normalizedAmount.toFixed(2)}. Reason: ${reason.trim()}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  if (process.env.ADMIN_ALERT_EMAIL) {
    await sendTransactionalEmail({
      to: process.env.ADMIN_ALERT_EMAIL,
      subject: `New ${normalizedType} Loan Application - ${member.name}`,
      text: `${member.name} submitted a ${normalizedType} loan application for $${normalizedAmount.toFixed(2)}.`,
      html: `<p><strong>${member.name}</strong> submitted a <strong>${normalizedType}</strong> loan application for <strong>$${normalizedAmount.toFixed(2)}</strong>.</p><p>Reason: ${reason.trim()}</p>`,
    });
  }

  if (process.env.ADMIN_ALERT_PHONE) {
    await sendSms({
      to: process.env.ADMIN_ALERT_PHONE,
      message: `New ${normalizedType} loan from ${member.name}: $${normalizedAmount.toFixed(2)}`,
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
  if (loan.status !== 'disbursed') {
    return 0;
  }
  if (loan.repaymentStatus === 'paid_off') {
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
  const activeLoan = loans.find((loan) => ['pending', 'approved'].includes(loan.status)) || null;
  const latestDecision = loans.find((loan) => ['approved', 'rejected', 'disbursed'].includes(loan.status)) || null;
  const eligibility = member ? await buildMemberLoanEligibility(member) : null;

  return {
    loans,
    activeLoan,
    latestDecision,
    eligibility,
    hasPendingApplication: loans.some((loan) => loan.status === 'pending'),
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
        const error = new Error(`Cannot approve: loan amount exceeds remaining general loan limit ($${availableMaxLoan.toFixed(2)}).`);
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
      text: `Dear ${member.name}, your ${loan.loanType} loan application for $${Number(loan.amount).toFixed(2)} is now ${status}.${loan.paymentMethod ? ` Payment method: ${paymentLabel}.` : ''}`,
      html: `<p>Dear ${member.name},</p><p>Your <strong>${loan.loanType}</strong> loan application for <strong>$${Number(loan.amount).toFixed(2)}</strong> is now <strong>${status}</strong>.</p>${paymentNote}${loan.adminNote ? `<p>Note: ${loan.adminNote}</p>` : ''}${contractNote}`,
    });
  }

  if (member?.phone) {
    await sendSms({
      to: member.phone,
      message: `Loan update: your ${loan.loanType} loan for $${Number(loan.amount).toFixed(2)} is now ${status}.${loan.paymentMethod ? ` Payment: ${paymentLabel}.` : ''}`,
    });
  }

  await createMemberNotification({
    memberId: loan.member._id || loan.member,
    type: 'loan',
    title: `Loan Application ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    message: `Your ${loan.loanType} loan application for $${Number(loan.amount).toFixed(2)} is now ${status}.${loan.adminNote ? ` Note: ${loan.adminNote}` : ''}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  return loan;
}

async function disburseLoanApplication(loanId, {
  paymentMethod = '',
  transferReference = '',
  disbursementNote = '',
  disbursedBy = 'Admin',
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

  loan.status = 'disbursed';
  loan.paymentMethod = normalizedPaymentMethod;
  loan.disbursedAt = new Date();
  loan.disbursedBy = disbursedBy?.trim() || 'Admin';
  loan.disbursementReference = transferReference?.trim() || '';
  loan.disbursementNote = disbursementNote?.trim() || '';
  loan.outstandingBalance = Number(loan.amount || 0);
  loan.totalRepaid = 0;
  loan.repaymentStatus = 'active';
  await loan.save();

  const member = loan.member;
  const paymentLabel = formatPaymentMethodLabel(loan.paymentMethod);
  const referenceNote = loan.disbursementReference ? ` Reference: ${loan.disbursementReference}.` : '';
  const transferMessage = `Dear ${member.name}, your ${loan.loanType} loan of $${Number(loan.amount).toFixed(2)} has been transferred to you via ${paymentLabel}.${referenceNote}`;

  if (member?.email) {
    await sendTransactionalEmail({
      to: member.email,
      subject: 'Loan Money Transferred',
      text: transferMessage,
      html: `<p>Dear ${member.name},</p><p>Your <strong>${loan.loanType}</strong> loan of <strong>$${Number(loan.amount).toFixed(2)}</strong> has been transferred to you.</p><p><strong>Method:</strong> ${paymentLabel}</p>${loan.disbursementReference ? `<p><strong>Reference:</strong> ${loan.disbursementReference}</p>` : ''}${loan.disbursementNote ? `<p><strong>Note:</strong> ${loan.disbursementNote}</p>` : ''}<p>Please check your member dashboard for full transfer details.</p>`,
    });
  }

  if (member?.phone) {
    await sendSms({
      to: member.phone,
      message: `Loan transferred: $${Number(loan.amount).toFixed(2)} via ${paymentLabel}.${referenceNote}`,
    });
  }

  await createMemberNotification({
    memberId: loan.member._id || loan.member,
    type: 'loan',
    title: 'Loan Money Transferred',
    message: `Your ${loan.loanType} loan of $${Number(loan.amount).toFixed(2)} was transferred via ${paymentLabel}.${referenceNote}`,
    relatedId: loan._id,
    relatedModel: 'LoanApplication',
  });

  return loan;
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
  disburseLoanApplication,
  formatPaymentMethodLabel,
  getAllLoanTakers,
  getActiveBorrowers,
  getLoanPortfolioSummary,
};
