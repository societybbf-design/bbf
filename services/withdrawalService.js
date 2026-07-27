const WithdrawalRequest = require('../models/WithdrawalRequest');
const User = require('../models/User');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { createAdminNotification } = require('./adminNotificationService');

function calculateWithdrawalAvailability({ savings = 0, pendingAmount = 0, requestedAmount = 0 }) {
  const normalizedSavings = Number(savings) || 0;
  const normalizedPending = Number(pendingAmount) || 0;
  const normalizedRequested = Number(requestedAmount) || 0;
  const availableAmount = Math.max(normalizedSavings - normalizedPending, 0);
  const remainingAfterRequest = availableAmount - normalizedRequested;

  return {
    availableAmount,
    canRequest: normalizedRequested > 0 && remainingAfterRequest >= 0,
    remainingAfterRequest,
  };
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

  const pendingRequests = await WithdrawalRequest.find({ member: memberId, status: { $in: ['pending', 'approved'] } });
  const pendingAmount = pendingRequests.reduce((sum, request) => sum + Number(request.amount), 0);
  const availability = calculateWithdrawalAvailability({
    savings: member.savings,
    pendingAmount,
    requestedAmount: amount,
  });

  if (!availability.canRequest) {
    const error = new Error('Requested amount exceeds available balance.');
    error.status = 400;
    throw error;
  }

  const request = await WithdrawalRequest.create({
    member: memberId,
    amount: Number(amount) || 0,
    reason: reason?.trim() || '',
  });

  await createAdminNotification({
    type: 'withdrawal',
    title: `Withdrawal Request from ${member.name}`,
    message: `${member.name} requested a withdrawal of $${Number(request.amount).toFixed(2)}.`,
    relatedId: request._id,
    relatedModel: 'WithdrawalRequest',
  });

  return { request, availability };
}

async function getWithdrawalRequestsForAdmin() {
  return WithdrawalRequest.find({}).populate({ path: 'member', select: 'name email savings profit' }).sort({ createdAt: -1 }).lean();
}

async function updateWithdrawalRequestStatus(requestId, status, adminNote = '') {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    const error = new Error('Withdrawal request not found.');
    error.status = 404;
    throw error;
  }

  request.status = status;
  request.adminNote = adminNote?.trim() || '';
  if (status === 'processed') {
    const member = await User.findById(request.member);
    if (member) {
      member.savings = Math.max(Number(member.savings) - Number(request.amount), 0);
      await member.save();
    }
  }
  await request.save();

  const member = await User.findById(request.member).select('name email phone');
  if (member) {
    await notifyMemberByEmailAndSms(member, {
      subject: `Withdrawal Request ${status}`,
      message: `Dear ${member.name}, your withdrawal request for $${Number(request.amount).toFixed(2)} is now ${status}.`,
    });
  }

  return request;
}

module.exports = {
  calculateWithdrawalAvailability,
  createWithdrawalRequest,
  getWithdrawalRequestsForAdmin,
  updateWithdrawalRequestStatus,
};
