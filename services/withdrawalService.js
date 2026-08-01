const WithdrawalRequest = require('../models/WithdrawalRequest');
const User = require('../models/User');
const { notifyWithdrawalEvent } = require('./financialNotificationService');
const { recordAdminActivity } = require('./activityLogService');
const { normalizePaymentChannel } = require('./paymentChannelService');
const { createAdminNotification } = require('./adminNotificationService');
const { formatMoney } = require('./moneyFormat');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

/**
 * Withdrawals may only be funded from the member's Advance Balance.
 * Savings / profit / locked funds are never eligible for payout.
 *
 * Accepts `advanceBalance` (preferred). Legacy callers may still pass `savings`
 * as a misnamed alias — treated as advance when `advanceBalance` is omitted.
 */
function calculateWithdrawalAvailability({
  advanceBalance = null,
  savings = null,
  pendingAmount = 0,
  requestedAmount = 0,
} = {}) {
  const balanceSource = advanceBalance != null ? advanceBalance : savings;
  const normalizedAdvance = money(balanceSource);
  const normalizedPending = money(pendingAmount);
  const normalizedRequested = money(requestedAmount);
  const availableAmount = Math.max(money(normalizedAdvance - normalizedPending), 0);
  const remainingAfterRequest = money(availableAmount - normalizedRequested);

  return {
    availableAmount,
    advanceBalance: normalizedAdvance,
    pendingAmount: normalizedPending,
    canRequest: normalizedRequested > 0 && remainingAfterRequest >= -0.001,
    remainingAfterRequest,
  };
}

async function getReservedWithdrawalAmount(memberId, { excludeRequestId = null } = {}) {
  const filter = {
    member: memberId,
    status: { $in: ['pending', 'approved'] },
  };
  if (excludeRequestId) {
    filter._id = { $ne: excludeRequestId };
  }
  const openRequests = await WithdrawalRequest.find(filter).select('amount').lean();
  return money(openRequests.reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

async function assertAdvanceCoversAmount(member, amount, { excludeRequestId = null } = {}) {
  const pendingAmount = await getReservedWithdrawalAmount(member._id || member, { excludeRequestId });
  const availability = calculateWithdrawalAvailability({
    advanceBalance: member.advanceBalance,
    pendingAmount,
    requestedAmount: amount,
  });
  if (!availability.canRequest) {
    const error = new Error(
      `Insufficient Advance Balance. Requested ${formatMoney(amount, 2)}, `
      + `available advance ${formatMoney(availability.availableAmount, 2)} `
      + `(advance ${formatMoney(availability.advanceBalance, 2)} − reserved ${formatMoney(pendingAmount, 2)}). `
      + 'Withdrawals cannot be paid from savings or other locked funds.'
    );
    error.status = 400;
    error.availability = availability;
    throw error;
  }
  return availability;
}

async function createWithdrawalRequest({ memberId, amount, reason }) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (member.status === 'inactive') {
    const error = new Error('Inactive members cannot submit withdrawal requests.');
    error.status = 403;
    throw error;
  }
  if (member.status === 'deleted') {
    const error = new Error('Removed members cannot submit withdrawal requests.');
    error.status = 403;
    throw error;
  }

  const requested = money(amount);
  if (!(requested > 0)) {
    const error = new Error('Withdrawal amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const availability = await assertAdvanceCoversAmount(member, requested);

  const request = await WithdrawalRequest.create({
    member: memberId,
    amount: requested,
    reason: reason?.trim() || '',
    status: 'pending',
  });

  await notifyWithdrawalEvent({
    member,
    request,
    status: 'pending',
  });

  return { request, availability };
}

async function getWithdrawalRequestsForAdmin({ statusIn = null } = {}) {
  const filter = {};
  if (Array.isArray(statusIn) && statusIn.length) {
    filter.status = { $in: statusIn };
  }
  return WithdrawalRequest.find(filter)
    .populate({ path: 'member', select: 'name email savings profit advanceBalance status' })
    .sort({ createdAt: -1 })
    .lean();
}

async function listCeoPendingWithdrawals() {
  return getWithdrawalRequestsForAdmin({ statusIn: ['pending'] });
}

async function listCashierWithdrawalQueue() {
  const rows = await getWithdrawalRequestsForAdmin({ statusIn: ['approved'] });
  return rows.map((row) => {
    const advanceBalance = money(row.member?.advanceBalance);
    const amount = money(row.amount);
    return {
      ...row,
      advanceBalance,
      hasSufficientAdvance: advanceBalance + 0.001 >= amount,
      advanceShortfall: Math.max(money(amount - advanceBalance), 0),
    };
  });
}

async function approveWithdrawal(requestId, {
  reviewedBy = 'CEO',
  adminNote = '',
  actor = null,
  ip = '',
} = {}) {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    const error = new Error('Withdrawal request not found.');
    error.status = 404;
    throw error;
  }
  if (request.status !== 'pending') {
    const error = new Error('Only pending withdrawal requests can be approved by the CEO.');
    error.status = 409;
    throw error;
  }

  const member = await User.findById(request.member);
  if (!member) {
    const error = new Error('Member not found for this withdrawal request.');
    error.status = 404;
    throw error;
  }

  // Re-validate advance before sending to cashier queue.
  await assertAdvanceCoversAmount(member, request.amount, { excludeRequestId: request._id });

  request.status = 'approved';
  request.adminNote = adminNote?.trim() || request.adminNote || '';
  await request.save();

  await notifyWithdrawalEvent({
    member,
    request,
    status: 'approved',
    actorName: reviewedBy,
  });

  await createAdminNotification({
    type: 'withdrawal',
    title: `Withdrawal approved: ${member.name}`,
    message: `${reviewedBy} approved ${formatMoney(request.amount, 2)}. Cashier: verify Advance Balance before payout.`,
    relatedId: request._id,
    relatedModel: 'WithdrawalRequest',
    targetRoles: ['cashier'],
  }).catch(() => null);

  await recordAdminActivity({
    action: 'withdrawal_status_updated',
    actor,
    targetUserId: member._id,
    targetEmail: member.email || '',
    details: {
      amount: request.amount,
      status: 'approved',
      previousStatus: 'pending',
    },
    ip,
  });

  return request;
}

async function rejectWithdrawal(requestId, {
  reviewedBy = 'CEO',
  adminNote = '',
  actor = null,
  ip = '',
} = {}) {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    const error = new Error('Withdrawal request not found.');
    error.status = 404;
    throw error;
  }
  if (!['pending', 'approved'].includes(request.status)) {
    const error = new Error('Only pending or approved withdrawal requests can be rejected.');
    error.status = 409;
    throw error;
  }

  const previousStatus = request.status;
  request.status = 'rejected';
  request.adminNote = adminNote?.trim() || request.adminNote || '';
  await request.save();

  const member = await User.findById(request.member).select('name email phone');
  if (member) {
    await notifyWithdrawalEvent({
      member,
      request,
      status: 'rejected',
      actorName: reviewedBy,
    });
  }

  await recordAdminActivity({
    action: 'withdrawal_status_updated',
    actor,
    targetUserId: member?._id || request.member,
    targetEmail: member?.email || '',
    details: {
      amount: request.amount,
      status: 'rejected',
      previousStatus,
    },
    ip,
  });

  return request;
}

/**
 * Cashier payout — only after CEO approval, and only from Advance Balance.
 */
async function processWithdrawalPayout(requestId, {
  processedBy = 'Cashier',
  paymentMethod = 'cash',
  disbursementReference = '',
  adminNote = '',
  actor = null,
  ip = '',
} = {}) {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    const error = new Error('Withdrawal request not found.');
    error.status = 404;
    throw error;
  }
  if (request.status === 'processed') {
    const error = new Error('This withdrawal has already been processed.');
    error.status = 409;
    throw error;
  }
  if (request.status !== 'approved') {
    const error = new Error('Withdrawal must be approved by the CEO before the Cashier can disburse it.');
    error.status = 409;
    throw error;
  }

  const member = await User.findById(request.member);
  if (!member) {
    const error = new Error('Member not found for this withdrawal request.');
    error.status = 404;
    throw error;
  }

  const amount = money(request.amount);
  const advanceBalance = money(member.advanceBalance);
  if (advanceBalance + 0.001 < amount) {
    const error = new Error(
      `Insufficient Advance Balance for payout. Requested ${formatMoney(amount, 2)}, `
      + `advance available ${formatMoney(advanceBalance, 2)}. `
      + 'Withdrawal blocked — cannot pay from savings or other locked funds.'
    );
    error.status = 400;
    error.availability = {
      availableAmount: advanceBalance,
      advanceBalance,
      canRequest: false,
      remainingAfterRequest: money(advanceBalance - amount),
    };
    throw error;
  }

  member.advanceBalance = money(Math.max(advanceBalance - amount, 0));
  await member.save();

  request.status = 'processed';
  request.paymentMethod = normalizePaymentChannel(paymentMethod, request.paymentMethod || 'cash');
  request.disbursementReference = String(disbursementReference || '').trim();
  if (adminNote?.trim()) {
    request.adminNote = adminNote.trim();
  }
  request.processedAt = new Date();
  request.processedBy = String(processedBy || 'Cashier').trim();
  await request.save();

  await notifyWithdrawalEvent({
    member,
    request,
    status: 'processed',
    actorName: processedBy,
  });

  await recordAdminActivity({
    action: 'withdrawal_processed',
    actor,
    targetUserId: member._id,
    targetEmail: member.email || '',
    details: {
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      disbursementReference: request.disbursementReference,
      previousStatus: 'approved',
      paidFrom: 'advanceBalance',
      advanceBalanceAfter: member.advanceBalance,
    },
    ip,
  });

  return {
    request,
    member: {
      id: member._id,
      name: member.name,
      advanceBalance: member.advanceBalance,
      savings: member.savings,
    },
    message: `Withdrawal of ${formatMoney(amount, 2)} paid from Advance Balance. Remaining advance ${formatMoney(member.advanceBalance, 2)}.`,
  };
}

/**
 * Legacy PATCH bridge with strict transition + role checks.
 */
async function updateWithdrawalRequestStatus(requestId, status, adminNote = '', options = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  const role = options.role || options.actor?.role || '';
  const canReview = Boolean(options.canReview);
  const canDisburse = Boolean(options.canDisburse) && role === 'cashier';

  if ((normalized === 'approved' || normalized === 'rejected') && !canReview) {
    const error = new Error('Only the CEO can approve or reject withdrawal requests.');
    error.status = 403;
    throw error;
  }
  if (normalized === 'processed' && !canDisburse) {
    const error = new Error('Only the Cashier can disburse CEO-approved withdrawals from Advance Balance.');
    error.status = 403;
    throw error;
  }

  if (normalized === 'approved') {
    return approveWithdrawal(requestId, {
      reviewedBy: options.actorName || 'CEO',
      adminNote,
      actor: options.actor || null,
      ip: options.ip || '',
    });
  }
  if (normalized === 'rejected') {
    return rejectWithdrawal(requestId, {
      reviewedBy: options.actorName || 'CEO',
      adminNote,
      actor: options.actor || null,
      ip: options.ip || '',
    });
  }
  if (normalized === 'processed') {
    const result = await processWithdrawalPayout(requestId, {
      processedBy: options.actorName || 'Cashier',
      paymentMethod: options.paymentMethod || 'cash',
      disbursementReference: options.disbursementReference || '',
      adminNote,
      actor: options.actor || null,
      ip: options.ip || '',
    });
    return result.request;
  }

  const error = new Error('Unsupported withdrawal status. Use approved, rejected, or processed.');
  error.status = 400;
  throw error;
}

module.exports = {
  money,
  calculateWithdrawalAvailability,
  createWithdrawalRequest,
  getWithdrawalRequestsForAdmin,
  listCeoPendingWithdrawals,
  listCashierWithdrawalQueue,
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawalPayout,
  updateWithdrawalRequestStatus,
  getReservedWithdrawalAmount,
  assertAdvanceCoversAmount,
};
