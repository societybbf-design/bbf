const { formatMoney } = require('./moneyFormat');
const path = require('path');
const fs = require('fs');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const User = require('../models/User');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms, generateLoanRepaymentReceiptPdf, formatPaymentMethodLabel } = require('./notificationService');
const {
  withMongoTransaction,
  bindSession,
  sessionOpt,
  createWithSession,
} = require('./mongoTransaction');

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
    targetRoles: ['ceo', 'cashier'],
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

async function settleLoanFundingOnRepayment(loan, repaymentAmount, reviewedBy = 'Cashier', session = null) {
  const InternalBorrowing = require('../models/InternalBorrowing');
  const { settleInternalBorrowing } = require('./advanceBorrowingService');
  const { allocateFromBookBalance } = require('./emergencyReserveService');

  let remaining = money2(repaymentAmount);
  const settlements = [];
  let reserveReplenished = 0;

  const openBorrowings = await bindSession(
    InternalBorrowing.find({
      loan: loan._id,
      status: { $in: ['open', 'partial'] },
    }).sort({ createdAt: 1 }),
    session
  );

  for (const borrowing of openBorrowings) {
    if (remaining <= 0.001) break;
    const outstanding = money2(Number(borrowing.amount || 0) - Number(borrowing.amountSettled || 0));
    if (!(outstanding > 0.001)) continue;
    const pay = money2(Math.min(remaining, outstanding));
    const settled = await settleInternalBorrowing(borrowing._id, {
      amount: pay,
      recordedBy: reviewedBy,
      notes: `Loan repayment settlement · refund lender advance for loan ${loan._id}`,
      cashReceived: true,
      skipBankCredit: true,
      skipNotifications: Boolean(session),
      session,
    });
    settlements.push({
      borrowingId: borrowing._id,
      settledAmount: settled.settledAmount,
      lenderName: settled.lender?.name,
      refundedAmount: settled.lender?.refundedAmount,
    });
    remaining = money2(remaining - pay);
  }

  // Re-read reserve outstanding from DB when in a session (loan doc may be stale).
  const loanFresh = session
    ? await bindSession(LoanApplication.findById(loan._id).select('fundingReserveOutstanding'), session)
    : loan;
  const reserveDue = money2(loanFresh?.fundingReserveOutstanding || loan.fundingReserveOutstanding || 0);
  if (reserveDue > 0.001 && remaining > 0.001) {
    const replenish = money2(Math.min(reserveDue, remaining));
    await allocateFromBookBalance(replenish, {
      note: `Loan repayment replenish Emergency / Reserve Fund · loan ${loan._id}`,
      createdBy: reviewedBy,
      session,
    });
    const updated = await LoanApplication.findOneAndUpdate(
      {
        _id: loan._id,
        fundingReserveOutstanding: { $gte: money2(replenish - 0.001) },
      },
      {
        $inc: { fundingReserveOutstanding: -replenish },
        $set: { updatedAt: new Date() },
      },
      sessionOpt(session, { new: true })
    );
    if (!updated) {
      const err = new Error('Unable to update reserve outstanding after replenishment.');
      err.status = 409;
      throw err;
    }
    loan.fundingReserveOutstanding = money2(updated.fundingReserveOutstanding);
    reserveReplenished = replenish;
    remaining = money2(remaining - replenish);
  }

  return {
    settlements,
    reserveReplenished,
    remainingCash: remaining,
  };
}

async function applyApprovedRepayment(repayment, loan, member, reviewedBy = 'Admin', {
  skipBankCredit = false,
  session = null,
  skipNotifications = false,
} = {}) {
  const pay = money2(repayment.amount);
  if (!(pay > 0)) {
    const error = new Error('Repayment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const outstandingBalance = getLoanOutstandingBalance(loan);
  const pendingOthers = await getPendingRepaymentAmount(loan._id, repayment._id);
  const availableToPay = Math.max(0, money2(outstandingBalance - pendingOthers));

  if (pay > availableToPay + 0.001) {
    const error = new Error(`Repayment exceeds available outstanding balance (${formatMoney(availableToPay, 2)}).`);
    error.status = 400;
    throw error;
  }

  // Atomic outstanding decrement prevents concurrent over-apply.
  const updatedLoan = await LoanApplication.findOneAndUpdate(
    {
      _id: loan._id,
      status: 'disbursed',
      outstandingBalance: { $gte: money2(pay - 0.001) },
    },
    {
      $inc: {
        outstandingBalance: -pay,
        totalRepaid: pay,
      },
      $set: { updatedAt: new Date() },
    },
    sessionOpt(session, { new: true })
  );
  if (!updatedLoan) {
    const error = new Error(
      'Unable to apply repayment — outstanding balance changed or loan is no longer disbursed. Refresh and retry.'
    );
    error.status = 409;
    throw error;
  }

  const balanceAfter = money2(Math.max(0, updatedLoan.outstandingBalance));
  const clearSet = balanceAfter <= 0.001
    ? { outstandingBalance: 0, repaymentStatus: 'paid_off', status: 'completed' }
    : { repaymentStatus: 'active' };
  if (balanceAfter <= 0.001) {
    updatedLoan.outstandingBalance = 0;
    updatedLoan.repaymentStatus = 'paid_off';
    updatedLoan.status = 'completed';
  } else {
    updatedLoan.repaymentStatus = 'active';
  }
  await LoanApplication.updateOne(
    { _id: loan._id },
    { $set: { ...clearSet, updatedAt: new Date() } },
    sessionOpt(session)
  );

  // Keep caller's loan doc in sync for receipt / settlement.
  loan.outstandingBalance = updatedLoan.outstandingBalance;
  loan.totalRepaid = updatedLoan.totalRepaid;
  loan.repaymentStatus = updatedLoan.repaymentStatus;
  loan.status = updatedLoan.status;

  repayment.status = 'approved';
  repayment.balanceBefore = outstandingBalance;
  repayment.balanceAfter = balanceAfter <= 0.001 ? 0 : balanceAfter;
  repayment.approvedAt = new Date();
  repayment.reviewedBy = reviewedBy?.trim() || 'Admin';
  repayment.receiptNumber = repayment.receiptNumber
    || `REP-${new Date().getFullYear()}-${String(repayment._id).slice(-6).toUpperCase()}`;
  await repayment.save(sessionOpt(session));

  let bankLedger = null;
  if (!skipBankCredit) {
    const { creditInbound } = require('./bankLedgerService');
    bankLedger = await creditInbound({
      type: 'loan_repayment',
      amount: pay,
      referenceType: 'LoanRepayment',
      referenceId: repayment._id,
      note: `Loan repayment ${repayment.receiptNumber || repayment._id} · ${member?.name || 'member'}`,
      createdBy: reviewedBy,
      paymentChannel: repayment.paymentMethod === 'cash'
        ? 'cash'
        : (repayment.paymentMethod === 'bank_transfer' ? 'bank' : (repayment.paymentMethod === 'mobile_banking' ? 'mfs' : '')),
      session,
    });
  }

  // Hard-fail: lender refunds / reserve replenish must succeed with the repayment.
  const fundingSettlement = await settleLoanFundingOnRepayment(loan, pay, reviewedBy, session);

  return { repayment, bankLedger, fundingSettlement, loan, balanceAfter: repayment.balanceAfter };
}

async function finalizeRepaymentArtifacts(repayment, loan, member, reviewedBy, fundingSettlement) {
  const pdfBuffer = await generateLoanRepaymentReceiptPdf({
    repayment,
    loan,
    member,
    adminName: reviewedBy,
  });
  repayment.receiptPath = saveRepaymentReceiptFile(repayment._id, pdfBuffer);
  await repayment.save();

  if (!member) return;

  const balanceAfter = money2(repayment.balanceAfter);
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

async function recordAdminLoanRepayment({
  memberId,
  amount,
  repaymentType = 'partial',
  paymentMethod = 'cash',
  adminNote = '',
  reviewedBy = 'Admin',
  skipBankCredit = false,
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

  const { parseLooseMoney } = require('./loanService');
  const normalizedAmount = parseLooseMoney(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    const error = new Error('Enter a valid payment amount greater than zero.');
    error.status = 400;
    throw error;
  }

  const rawType = String(repaymentType || 'partial').toLowerCase().trim();
  const normalizedType = rawType === 'full' ? 'full' : 'partial';

  const appliedBundle = await withMongoTransaction(async (session) => {
    const sessionLoan = await bindSession(
      LoanApplication.findOne({
        member: memberId,
        status: 'disbursed',
        repaymentStatus: { $in: ['active', 'none'] },
      }).sort({ disbursedAt: -1, createdAt: -1 }),
      session
    );
    if (!sessionLoan) {
      const error = new Error('No active disbursed loan with outstanding balance.');
      error.status = 400;
      throw error;
    }

    const outstandingBalance = getLoanOutstandingBalance(sessionLoan);
    if (!(outstandingBalance > 0.001)) {
      const error = new Error('No active disbursed loan with outstanding balance.');
      error.status = 400;
      throw error;
    }

    const pendingRepaymentAmount = await getPendingRepaymentAmount(sessionLoan._id);
    const availableToPay = Math.max(0, money2(outstandingBalance - pendingRepaymentAmount));
    const finalAmount = normalizedType === 'full' ? availableToPay : money2(normalizedAmount);

    if (finalAmount <= 0 || finalAmount > availableToPay + 0.001) {
      const error = new Error(
        `Payment amount must be between ৳0.01 and ${formatMoney(availableToPay, 2)} (current remaining due).`
      );
      error.status = 400;
      throw error;
    }

    const repayment = await createWithSession(LoanRepayment, {
      member: memberId,
      loan: sessionLoan._id,
      amount: money2(finalAmount),
      repaymentType: normalizedType,
      paymentMethod,
      adminNote: adminNote?.trim() || '',
      adminManual: true,
      status: 'pending',
    }, session);

    const applied = await applyApprovedRepayment(
      repayment,
      sessionLoan,
      member,
      reviewedBy,
      { skipBankCredit, session, skipNotifications: true }
    );

    return {
      repayment: applied.repayment,
      loan: applied.loan || sessionLoan,
      fundingSettlement: applied.fundingSettlement || null,
      finalAmount: money2(finalAmount),
    };
  });

  try {
    await finalizeRepaymentArtifacts(
      appliedBundle.repayment,
      appliedBundle.loan,
      member,
      reviewedBy,
      appliedBundle.fundingSettlement
    );
  } catch (error) {
    console.warn('[recordAdminLoanRepayment] receipt/notify failed after commit:', error.message);
  }

  const fundingSettlement = appliedBundle.fundingSettlement;
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
    ? `Partial payment of ${formatMoney(money2(appliedBundle.finalAmount), 2)} recorded. Remaining due ${formatMoney(remainingDue, 2)}.`
    : `Payment of ${formatMoney(money2(appliedBundle.finalAmount), 2)} recorded. Loan is now Completed / Paid.`;

  return {
    repayment: appliedBundle.repayment,
    summary,
    fundingSettlement,
    advanceRefunded,
    reserveReplenished: Number(fundingSettlement?.reserveReplenished || 0),
    amountPaid: money2(appliedBundle.finalAmount),
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

  const applied = await withMongoTransaction(async (session) => {
    const sessionRepayment = await bindSession(LoanRepayment.findById(repayment._id), session);
    const sessionLoan = await bindSession(LoanApplication.findById(loan._id), session);
    if (!sessionRepayment || sessionRepayment.status !== 'pending') {
      const error = new Error('This repayment request has already been processed.');
      error.status = 400;
      throw error;
    }
    sessionRepayment.adminNote = repayment.adminNote;
    sessionRepayment.reviewedBy = repayment.reviewedBy;
    return applyApprovedRepayment(sessionRepayment, sessionLoan, repayment.member, reviewedBy, {
      session,
      skipNotifications: true,
    });
  });

  try {
    await finalizeRepaymentArtifacts(
      applied.repayment,
      applied.loan || loan,
      repayment.member,
      reviewedBy,
      applied.fundingSettlement
    );
  } catch (error) {
    console.warn('[updateLoanRepaymentStatus] receipt/notify failed after commit:', error.message);
  }

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
