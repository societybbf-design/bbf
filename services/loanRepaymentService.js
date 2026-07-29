const { formatMoney } = require('./moneyFormat');
const path = require('path');
const fs = require('fs');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const User = require('../models/User');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms, generateLoanRepaymentReceiptPdf, formatPaymentMethodLabel } = require('./notificationService');

function getLoanOutstandingBalance(loan = {}) {
  if (loan.status === 'completed' || loan.repaymentStatus === 'paid_off') {
    return 0;
  }
  if (loan.status !== 'disbursed') {
    return 0;
  }
  if (loan.outstandingBalance !== undefined && loan.outstandingBalance !== null) {
    return Math.max(Number(loan.outstandingBalance) || 0, 0);
  }
  return Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0);
}

function money2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function repaymentStatusLabel(loan = {}, outstandingBalance = null) {
  const outstanding = outstandingBalance == null
    ? getLoanOutstandingBalance(loan)
    : Number(outstandingBalance);
  if (loan.status === 'completed' || loan.repaymentStatus === 'paid_off' || outstanding <= 0) {
    return 'Completed / Paid';
  }
  if (loan.repaymentStatus === 'active' || loan.status === 'disbursed') {
    return 'Active';
  }
  return loan.repaymentStatus || loan.status || '—';
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
    if (loan.repaymentStatus !== 'paid_off' || loan.status !== 'completed') {
      loan.outstandingBalance = 0;
      loan.repaymentStatus = 'paid_off';
      loan.status = 'completed';
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
    $or: [
      { status: 'completed' },
      { status: 'disbursed', repaymentStatus: 'paid_off' },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function getMemberOutstandingSummary(memberId) {
  const { resolveLoanFundingSourceLabel } = require('./loanService');
  const InternalBorrowing = require('../models/InternalBorrowing');

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
      repaymentStatus: lastClearedLoan?.repaymentStatus || 'paid_off',
      displayStatus: lastClearedLoan ? 'Completed / Paid' : 'No active loan',
      fundingSource: lastClearedLoan?.fundingSource || '',
      fundingSourceLabel: lastClearedLoan ? resolveLoanFundingSourceLabel(lastClearedLoan) : '',
      fundingLenderName: lastClearedLoan?.fundingLenderName || '',
      fundingReserveOutstanding: 0,
      openBorrowings: [],
    };
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingRepaymentAmount = await getPendingRepaymentAmount(loan._id);
  const availableToPay = Math.max(0, Number((outstandingBalance - pendingRepaymentAmount).toFixed(2)));

  const openBorrowings = await InternalBorrowing.find({
    loan: loan._id,
    status: { $in: ['open', 'partial'] },
  })
    .populate('lender', 'name email')
    .sort({ createdAt: 1 })
    .lean();

  const openBorrowingRows = openBorrowings.map((row) => ({
    id: row._id,
    lenderName: row.lenderName || row.lender?.name || 'Lender',
    amount: Number(row.amount || 0),
    amountSettled: Number(row.amountSettled || 0),
    outstanding: Math.max(0, Number((Number(row.amount || 0) - Number(row.amountSettled || 0)).toFixed(2))),
    status: row.status,
  }));

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
    repaymentStatus: loan.repaymentStatus || 'active',
    displayStatus: repaymentStatusLabel(loan, outstandingBalance),
    fundingSource: loan.fundingSource || '',
    fundingSourceLabel: resolveLoanFundingSourceLabel(loan),
    fundingLenderName: loan.fundingLenderName || '',
    fundingAdvanceAmount: Number(loan.fundingAdvanceAmount || 0),
    fundingReserveAmount: Number(loan.fundingReserveAmount || 0),
    fundingReserveOutstanding: Number(loan.fundingReserveOutstanding || 0),
    openBorrowings: openBorrowingRows,
  };
}

async function createLoanRepaymentRequest({
  memberId,
  amount,
  repaymentType = 'partial',
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
    const error = new Error(`Repayment amount exceeds available outstanding balance (${formatMoney(availableToPay, 2)}).`);
    error.status = 400;
    throw error;
  }

  const normalizedType = repaymentType === 'full' ? 'full' : 'partial';
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
    message: `Your loan repayment request for ${formatMoney(finalAmount, 2)} was submitted and is awaiting admin verification.`,
    relatedId: repayment._id,
    relatedModel: 'LoanRepayment',
  });

  await createAdminNotification({
    type: 'loan',
    title: `Loan Repayment Request from ${member.name}`,
    message: `${member.name} submitted a ${normalizedType} repayment of ${formatMoney(finalAmount, 2)} for outstanding loan ${formatMoney(outstandingBalance, 2)}.`,
    relatedId: repayment._id,
    relatedModel: 'LoanRepayment',
  });

  await notifyMemberByEmailAndSms(member, {
    subject: 'Loan Repayment Request Submitted',
    message: `Dear ${member.name}, your loan repayment request for ${formatMoney(finalAmount, 2)} has been submitted and is awaiting admin verification.`,
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

async function settleLoanFundingOnRepayment(loan, repaymentAmount, reviewedBy = 'Cashier') {
  const InternalBorrowing = require('../models/InternalBorrowing');
  const { settleInternalBorrowing } = require('./advanceBorrowingService');
  const { allocateFromBookBalance } = require('./emergencyReserveService');

  let remaining = money2(repaymentAmount);
  const settlements = [];
  let reserveReplenished = 0;

  const openBorrowings = await InternalBorrowing.find({
    loan: loan._id,
    status: { $in: ['open', 'partial'] },
  }).sort({ createdAt: 1 });

  for (const borrowing of openBorrowings) {
    if (remaining <= 0.001) break;
    const outstanding = money2(Number(borrowing.amount || 0) - Number(borrowing.amountSettled || 0));
    if (!(outstanding > 0.001)) continue;
    const pay = money2(Math.min(remaining, outstanding));
    try {
      const settled = await settleInternalBorrowing(borrowing._id, {
        amount: pay,
        recordedBy: reviewedBy,
        notes: `Loan repayment settlement · refund lender advance for loan ${loan._id}`,
        cashReceived: true,
        skipBankCredit: true,
      });
      settlements.push({
        borrowingId: borrowing._id,
        settledAmount: settled.settledAmount,
        lenderName: settled.lender?.name,
        refundedAmount: settled.lender?.refundedAmount,
      });
      remaining = money2(remaining - pay);
    } catch (error) {
      console.warn('[settleLoanFundingOnRepayment] borrow settle failed:', error.message);
    }
  }

  const reserveDue = money2(loan.fundingReserveOutstanding || 0);
  if (reserveDue > 0.001 && remaining > 0.001) {
    const replenish = money2(Math.min(reserveDue, remaining));
    try {
      await allocateFromBookBalance(replenish, {
        note: `Loan repayment replenish Emergency / Reserve Fund · loan ${loan._id}`,
        createdBy: reviewedBy,
      });
      loan.fundingReserveOutstanding = money2(Math.max(0, reserveDue - replenish));
      await loan.save();
      reserveReplenished = replenish;
      remaining = money2(remaining - replenish);
    } catch (error) {
      console.warn('[settleLoanFundingOnRepayment] reserve replenish failed:', error.message);
    }
  }

  return {
    settlements,
    reserveReplenished,
    remainingCash: remaining,
  };
}

async function applyApprovedRepayment(repayment, loan, member, reviewedBy = 'Admin') {
  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingOthers = await getPendingRepaymentAmount(loan._id, repayment._id);
  const availableToPay = Math.max(0, outstandingBalance - pendingOthers);

  if (Number(repayment.amount) > availableToPay) {
    const error = new Error(`Repayment exceeds available outstanding balance (${formatMoney(availableToPay, 2)}).`);
    error.status = 400;
    throw error;
  }

  const balanceAfter = Math.max(0, Number((outstandingBalance - Number(repayment.amount)).toFixed(2)));
  loan.outstandingBalance = balanceAfter;
  loan.totalRepaid = Number((Number(loan.totalRepaid || 0) + Number(repayment.amount)).toFixed(2));
  loan.repaymentStatus = balanceAfter <= 0 ? 'paid_off' : 'active';
  if (balanceAfter <= 0) {
    loan.status = 'completed';
  }
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

  let bankLedger = null;
  try {
    const { creditInbound } = require('./bankLedgerService');
    bankLedger = await creditInbound({
      type: 'loan_repayment',
      amount: Number(repayment.amount),
      referenceType: 'LoanRepayment',
      referenceId: repayment._id,
      note: `Loan repayment ${repayment.receiptNumber || repayment._id} · ${member?.name || 'member'}`,
      createdBy: reviewedBy,
      paymentChannel: repayment.paymentMethod === 'cash'
        ? 'cash'
        : (repayment.paymentMethod === 'bank_transfer' ? 'bank' : (repayment.paymentMethod === 'mobile_banking' ? 'mfs' : '')),
    });
  } catch (error) {
    console.warn('[applyApprovedRepayment] ledger credit failed:', error.message);
  }

  // Refund lenders / replenish reserve when this loan was funded via advance or reserve.
  let fundingSettlement = null;
  try {
    fundingSettlement = await settleLoanFundingOnRepayment(loan, Number(repayment.amount), reviewedBy);
  } catch (error) {
    console.warn('[applyApprovedRepayment] funding settlement failed:', error.message);
  }

  if (member) {
    const clearedNote = balanceAfter <= 0
      ? ' Loan status is now Completed / Paid.'
      : ` Remaining outstanding balance: ${formatMoney(balanceAfter, 2)}.`;
    const fundingNoteParts = [];
    if (fundingSettlement?.settlements?.length) {
      fundingNoteParts.push(
        `Refunded lender advance ${formatMoney(
          fundingSettlement.settlements.reduce((s, row) => s + Number(row.refundedAmount || 0), 0),
          2
        )}.`
      );
    }
    if (fundingSettlement?.reserveReplenished > 0) {
      fundingNoteParts.push(
        `Replenished Emergency / Reserve Fund ${formatMoney(fundingSettlement.reserveReplenished, 2)}.`
      );
    }
    const fundingNote = fundingNoteParts.length ? ` ${fundingNoteParts.join(' ')}` : '';
    await notifyMemberByEmailAndSms(member, {
      subject: balanceAfter <= 0 ? 'Loan Fully Paid' : 'Loan Repayment Recorded',
      message: `Dear ${member.name}, your loan repayment of ${formatMoney(Number(repayment.amount), 2)} was recorded.${clearedNote}${fundingNote}`,
    });
    await createMemberNotification({
      memberId: member._id,
      type: 'repayment',
      title: balanceAfter <= 0 ? 'Loan Completed / Paid' : 'Loan Repayment Recorded',
      message: `Your loan repayment of ${formatMoney(Number(repayment.amount), 2)} was recorded by cashier.${clearedNote}${fundingNote}`,
      relatedId: repayment._id,
      relatedModel: 'LoanRepayment',
    });
  }

  return { repayment, bankLedger, fundingSettlement };
}

async function recordAdminLoanRepayment({
  memberId,
  amount,
  repaymentType = 'partial',
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

  const { parseLooseMoney } = require('./loanService');
  const normalizedAmount = parseLooseMoney(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    const error = new Error('Enter a valid payment amount greater than zero.');
    error.status = 400;
    throw error;
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingRepaymentAmount = await getPendingRepaymentAmount(loan._id);
  const availableToPay = Math.max(0, outstandingBalance - pendingRepaymentAmount);

  const rawType = String(repaymentType || 'partial').toLowerCase().trim();
  // Legacy 'installment' clients map to flexible partial / custom amount.
  const normalizedType = rawType === 'full' ? 'full' : 'partial';

  // Full clears the loan; partial accepts any cashier-typed amount up to remaining due.
  const finalAmount = normalizedType === 'full' ? availableToPay : money2(normalizedAmount);

  if (finalAmount <= 0 || finalAmount > availableToPay + 0.001) {
    const error = new Error(
      `Payment amount must be between ৳0.01 and ${formatMoney(availableToPay, 2)} (current remaining due).`
    );
    error.status = 400;
    throw error;
  }

  const repayment = await LoanRepayment.create({
    member: memberId,
    loan: loan._id,
    amount: money2(finalAmount),
    repaymentType: normalizedType,
    paymentMethod,
    adminNote: adminNote?.trim() || '',
    adminManual: true,
    status: 'pending',
  });

  const applied = await applyApprovedRepayment(repayment, loan, member, reviewedBy);
  const fundingSettlement = applied?.fundingSettlement || null;

  const summary = await getMemberOutstandingSummary(memberId);
  const settlementBits = [];
  const advanceRefunded = money2(
    (fundingSettlement?.settlements || []).reduce((sum, row) => sum + Number(row.refundedAmount || 0), 0)
  );
  if (advanceRefunded > 0.001) {
    const lenders = (fundingSettlement.settlements || [])
      .map((row) => row.lenderName)
      .filter(Boolean)
      .join(', ');
    settlementBits.push(
      `Refunded ${formatMoney(advanceRefunded, 2)} to lender advance${lenders ? ` (${lenders})` : ''}.`
    );
  }
  if (Number(fundingSettlement?.reserveReplenished || 0) > 0.001) {
    settlementBits.push(
      `Replenished Emergency / Reserve Fund ${formatMoney(fundingSettlement.reserveReplenished, 2)}.`
    );
  }

  const remainingDue = Number(summary.outstandingBalance || 0);
  const baseMessage = summary.hasOutstandingLoan
    ? `Partial payment of ${formatMoney(money2(finalAmount), 2)} recorded. Remaining due ${formatMoney(remainingDue, 2)}.`
    : `Payment of ${formatMoney(money2(finalAmount), 2)} recorded. Loan is now Completed / Paid.`;

  return {
    repayment: applied?.repayment || repayment,
    summary,
    fundingSettlement,
    advanceRefunded,
    reserveReplenished: Number(fundingSettlement?.reserveReplenished || 0),
    amountPaid: money2(finalAmount),
    remainingDue,
    loanCleared: Boolean(summary.loanCleared || !summary.hasOutstandingLoan),
    displayStatus: summary.displayStatus,
    message: `${baseMessage}${settlementBits.length ? ` ${settlementBits.join(' ')}` : ''}`,
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
        message: `Dear ${repayment.member.name}, your loan repayment request for ${formatMoney(Number(repayment.amount), 2)} was rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
      });
      await createMemberNotification({
        memberId: repayment.member._id,
        type: 'repayment',
        title: 'Loan Repayment Rejected',
        message: `Your loan repayment request for ${formatMoney(Number(repayment.amount), 2)} was rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
        relatedId: repayment._id,
        relatedModel: 'LoanRepayment',
      });
    }

    return repayment;
  }

  repayment.adminNote = adminNote?.trim() || repayment.adminNote || '';
  const applied = await applyApprovedRepayment(repayment, loan, repayment.member, reviewedBy);
  return applied.repayment || repayment;
}

module.exports = {
  getLoanOutstandingBalance,
  getActiveOutstandingLoan,
  getMemberOutstandingSummary,
  repaymentStatusLabel,
  createLoanRepaymentRequest,
  recordAdminLoanRepayment,
  getRepaymentsForMember,
  getRepaymentsForAdmin,
  getRepaymentReceiptFile,
  updateLoanRepaymentStatus,
};
