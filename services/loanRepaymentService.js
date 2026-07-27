const path = require('path');
const fs = require('fs');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const User = require('../models/User');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms, generateLoanRepaymentReceiptPdf, formatPaymentMethodLabel } = require('./notificationService');

function getLoanOutstandingBalance(loan = {}) {
  if (loan.status !== 'disbursed') {
    return 0;
  }
  if (loan.repaymentStatus === 'paid_off') {
    return 0;
  }
  if (loan.outstandingBalance !== undefined && loan.outstandingBalance !== null) {
    return Math.max(Number(loan.outstandingBalance) || 0, 0);
  }
  return Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0);
}

async function getActiveOutstandingLoan(memberId) {
  const loan = await LoanApplication.findOne({
    member: memberId,
    status: 'disbursed',
    repaymentStatus: { $in: ['active', 'none'] },
  }).sort({ disbursedAt: -1, createdAt: -1 });

  if (!loan) {
    return null;
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  if (outstandingBalance <= 0) {
    if (loan.repaymentStatus !== 'paid_off') {
      loan.outstandingBalance = 0;
      loan.repaymentStatus = 'paid_off';
      await loan.save();
    }
    return null;
  }

  if (loan.repaymentStatus === 'none') {
    loan.repaymentStatus = 'active';
    loan.outstandingBalance = outstandingBalance;
    await loan.save();
  }

  return loan;
}

async function getPendingRepaymentAmount(loanId, excludeRepaymentId = null) {
  const repayments = await LoanRepayment.find({
    loan: loanId,
    status: 'pending',
  }).lean();

  return repayments
    .filter((item) => !excludeRepaymentId || String(item._id) !== String(excludeRepaymentId))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

async function getLastClearedLoan(memberId) {
  return LoanApplication.findOne({
    member: memberId,
    status: 'disbursed',
    repaymentStatus: 'paid_off',
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function getMemberOutstandingSummary(memberId) {
  const loan = await getActiveOutstandingLoan(memberId);
  if (!loan) {
    const lastClearedLoan = await getLastClearedLoan(memberId);
    return {
      hasOutstandingLoan: false,
      loan: null,
      outstandingBalance: 0,
      totalRepaid: lastClearedLoan ? Number(lastClearedLoan.totalRepaid || lastClearedLoan.amount || 0) : 0,
      originalAmount: lastClearedLoan ? Number(lastClearedLoan.amount || 0) : 0,
      pendingRepaymentAmount: 0,
      availableToPay: 0,
      loanType: lastClearedLoan?.loanType || null,
      loanCleared: Boolean(lastClearedLoan),
      clearedAt: lastClearedLoan?.updatedAt || null,
      lastClearedLoan,
    };
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingRepaymentAmount = await getPendingRepaymentAmount(loan._id);
  const availableToPay = Math.max(0, Number((outstandingBalance - pendingRepaymentAmount).toFixed(2)));

  return {
    hasOutstandingLoan: true,
    loan: loan.toObject ? loan.toObject() : loan,
    outstandingBalance,
    totalRepaid: Number(loan.totalRepaid || 0),
    originalAmount: Number(loan.amount || 0),
    pendingRepaymentAmount,
    availableToPay,
    loanType: loan.loanType,
    disbursedAt: loan.disbursedAt,
    loanCleared: false,
    clearedAt: null,
    lastClearedLoan: null,
  };
}

async function createLoanRepaymentRequest({
  memberId,
  amount,
  repaymentType = 'installment',
  paymentMethod = 'cash',
  memberNote = '',
}) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (member.status === 'inactive') {
    const error = new Error('Inactive members cannot submit loan repayments.');
    error.status = 403;
    throw error;
  }
  if (member.status === 'deleted') {
    const error = new Error('Removed members cannot submit loan repayments.');
    error.status = 403;
    throw error;
  }

  const loan = await getActiveOutstandingLoan(memberId);
  if (!loan) {
    const error = new Error('No active outstanding loan found.');
    error.status = 400;
    throw error;
  }

  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Repayment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingRepaymentAmount = await getPendingRepaymentAmount(loan._id);
  const availableToPay = Math.max(0, outstandingBalance - pendingRepaymentAmount);

  if (normalizedAmount > availableToPay) {
    const error = new Error(`Repayment amount exceeds available outstanding balance ($${availableToPay.toFixed(2)}).`);
    error.status = 400;
    throw error;
  }

  const normalizedType = repaymentType === 'full' ? 'full' : 'installment';
  const finalAmount = normalizedType === 'full' ? availableToPay : normalizedAmount;

  if (finalAmount <= 0) {
    const error = new Error('No outstanding balance available to repay.');
    error.status = 400;
    throw error;
  }

  const existingPending = await LoanRepayment.findOne({ member: memberId, loan: loan._id, status: 'pending' });
  if (existingPending) {
    const error = new Error('You already have a pending loan repayment request. Please wait for admin verification.');
    error.status = 400;
    throw error;
  }

  const repayment = await LoanRepayment.create({
    member: memberId,
    loan: loan._id,
    amount: finalAmount,
    repaymentType: normalizedType,
    paymentMethod,
    memberNote: memberNote?.trim() || '',
    balanceBefore: outstandingBalance,
    status: 'pending',
  });

  await createMemberNotification({
    memberId,
    type: 'repayment',
    title: 'Loan Repayment Request Submitted',
    message: `Your loan repayment request for $${finalAmount.toFixed(2)} was submitted and is awaiting admin verification.`,
    relatedId: repayment._id,
    relatedModel: 'LoanRepayment',
  });

  await createAdminNotification({
    type: 'loan',
    title: `Loan Repayment Request from ${member.name}`,
    message: `${member.name} submitted a ${normalizedType} repayment of $${finalAmount.toFixed(2)} for outstanding loan $${outstandingBalance.toFixed(2)}.`,
    relatedId: repayment._id,
    relatedModel: 'LoanRepayment',
  });

  await notifyMemberByEmailAndSms(member, {
    subject: 'Loan Repayment Request Submitted',
    message: `Dear ${member.name}, your loan repayment request for $${finalAmount.toFixed(2)} has been submitted and is awaiting admin verification.`,
  });

  return { repayment, summary: await getMemberOutstandingSummary(memberId) };
}

async function getRepaymentsForMember(memberId) {
  return LoanRepayment.find({ member: memberId })
    .populate({ path: 'loan', select: 'amount loanType status outstandingBalance' })
    .sort({ createdAt: -1 })
    .lean();
}

async function getRepaymentsForAdmin(filters = {}) {
  const query = {};
  if (filters.status) {
    query.status = filters.status;
  }

  return LoanRepayment.find(query)
    .populate({ path: 'member', select: 'name email phone savings' })
    .populate({ path: 'loan', select: 'amount loanType outstandingBalance totalRepaid repaymentStatus' })
    .sort({ createdAt: -1 })
    .lean();
}

function saveRepaymentReceiptFile(repaymentId, pdfBuffer) {
  const receiptsDir = path.join(__dirname, '..', 'uploads', 'receipts');
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }
  const filename = `loan-repayment-${repaymentId}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(receiptsDir, filename), pdfBuffer);
  return `/uploads/receipts/${filename}`;
}

async function getRepaymentReceiptFile(repaymentId) {
  const repayment = await LoanRepayment.findById(repaymentId).lean();
  if (!repayment?.receiptPath) {
    const error = new Error('Repayment receipt not found.');
    error.status = 404;
    throw error;
  }

  const relativePath = repayment.receiptPath.replace(/^\/uploads\//, '');
  const fullPath = path.join(__dirname, '..', 'uploads', relativePath);
  if (!fs.existsSync(fullPath)) {
    const error = new Error('Receipt file is missing.');
    error.status = 404;
    throw error;
  }

  return { repayment, fullPath };
}

async function applyApprovedRepayment(repayment, loan, member, reviewedBy = 'Admin') {
  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingOthers = await getPendingRepaymentAmount(loan._id, repayment._id);
  const availableToPay = Math.max(0, outstandingBalance - pendingOthers);

  if (Number(repayment.amount) > availableToPay) {
    const error = new Error(`Repayment exceeds available outstanding balance ($${availableToPay.toFixed(2)}).`);
    error.status = 400;
    throw error;
  }

  const balanceAfter = Math.max(0, Number((outstandingBalance - Number(repayment.amount)).toFixed(2)));
  loan.outstandingBalance = balanceAfter;
  loan.totalRepaid = Number((Number(loan.totalRepaid || 0) + Number(repayment.amount)).toFixed(2));
  loan.repaymentStatus = balanceAfter <= 0 ? 'paid_off' : 'active';
  await loan.save();

  repayment.status = 'approved';
  repayment.balanceBefore = outstandingBalance;
  repayment.balanceAfter = balanceAfter;
  repayment.approvedAt = new Date();
  repayment.reviewedBy = reviewedBy?.trim() || 'Admin';
  repayment.receiptNumber = `REP-${new Date().getFullYear()}-${String(repayment._id).slice(-6).toUpperCase()}`;

  const pdfBuffer = await generateLoanRepaymentReceiptPdf({
    repayment,
    loan,
    member,
    adminName: reviewedBy,
  });
  repayment.receiptPath = saveRepaymentReceiptFile(repayment._id, pdfBuffer);
  await repayment.save();

  if (member) {
    await notifyMemberByEmailAndSms(member, {
      subject: 'Loan Repayment Recorded',
      message: `Dear ${member.name}, your loan repayment of $${Number(repayment.amount).toFixed(2)} was recorded. Remaining outstanding balance: $${balanceAfter.toFixed(2)}.`,
    });
    await createMemberNotification({
      memberId: member._id,
      type: 'repayment',
      title: 'Loan Repayment Recorded',
      message: `Your loan repayment of $${Number(repayment.amount).toFixed(2)} was recorded by admin. Remaining balance: $${balanceAfter.toFixed(2)}.`,
      relatedId: repayment._id,
      relatedModel: 'LoanRepayment',
    });
  }

  return repayment;
}

async function recordAdminLoanRepayment({
  memberId,
  amount,
  repaymentType = 'installment',
  paymentMethod = 'cash',
  adminNote = '',
  reviewedBy = 'Admin',
}) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (member.status === 'deleted') {
    const error = new Error('Removed members cannot receive loan payment processing.');
    error.status = 403;
    throw error;
  }

  const loan = await getActiveOutstandingLoan(memberId);
  if (!loan) {
    const error = new Error('No active disbursed loan with outstanding balance.');
    error.status = 400;
    throw error;
  }

  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Payment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingRepaymentAmount = await getPendingRepaymentAmount(loan._id);
  const availableToPay = Math.max(0, outstandingBalance - pendingRepaymentAmount);
  const normalizedType = repaymentType === 'full' ? 'full' : 'installment';
  const finalAmount = normalizedType === 'full' ? availableToPay : normalizedAmount;

  if (finalAmount <= 0 || finalAmount > availableToPay) {
    const error = new Error(`Payment amount must be between $0.01 and $${availableToPay.toFixed(2)}.`);
    error.status = 400;
    throw error;
  }

  const repayment = await LoanRepayment.create({
    member: memberId,
    loan: loan._id,
    amount: finalAmount,
    repaymentType: normalizedType,
    paymentMethod,
    adminNote: adminNote?.trim() || '',
    adminManual: true,
    status: 'pending',
  });

  await applyApprovedRepayment(repayment, loan, member, reviewedBy);

  return {
    repayment,
    summary: await getMemberOutstandingSummary(memberId),
  };
}

async function updateLoanRepaymentStatus(repaymentId, status, adminNote = '', reviewedBy = 'Admin') {
  const allowedStatuses = ['approved', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid repayment status.');
    error.status = 400;
    throw error;
  }

  const repayment = await LoanRepayment.findById(repaymentId)
    .populate({ path: 'member', select: 'name email phone' })
    .populate({ path: 'loan' });

  if (!repayment) {
    const error = new Error('Loan repayment request not found.');
    error.status = 404;
    throw error;
  }

  if (repayment.status !== 'pending') {
    const error = new Error('This repayment request has already been processed.');
    error.status = 400;
    throw error;
  }

  const loan = repayment.loan;
  if (!loan || loan.status !== 'disbursed') {
    const error = new Error('Linked loan is not active for repayment.');
    error.status = 400;
    throw error;
  }

  repayment.adminNote = adminNote?.trim() || '';
  repayment.reviewedBy = reviewedBy?.trim() || 'Admin';

  if (status === 'rejected') {
    repayment.status = 'rejected';
    await repayment.save();

    if (repayment.member) {
      await notifyMemberByEmailAndSms(repayment.member, {
        subject: 'Loan Repayment Rejected',
        message: `Dear ${repayment.member.name}, your loan repayment request for $${Number(repayment.amount).toFixed(2)} was rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
      });
      await createMemberNotification({
        memberId: repayment.member._id,
        type: 'repayment',
        title: 'Loan Repayment Rejected',
        message: `Your loan repayment request for $${Number(repayment.amount).toFixed(2)} was rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
        relatedId: repayment._id,
        relatedModel: 'LoanRepayment',
      });
    }

    return repayment;
  }

  repayment.adminNote = adminNote?.trim() || repayment.adminNote || '';
  await applyApprovedRepayment(repayment, loan, repayment.member, reviewedBy);
  return repayment;
}

module.exports = {
  getLoanOutstandingBalance,
  getActiveOutstandingLoan,
  getMemberOutstandingSummary,
  createLoanRepaymentRequest,
  recordAdminLoanRepayment,
  getRepaymentsForMember,
  getRepaymentsForAdmin,
  getRepaymentReceiptFile,
  updateLoanRepaymentStatus,
};
