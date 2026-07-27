const Refund = require('../models/Refund');
const User = require('../models/User');
const { notifyMemberByEmailAndSms } = require('./notificationService');

async function getRefundsByMember(memberId) {
  return Refund.find({ member: memberId }).sort({ createdAt: -1 }).lean();
}

async function createRefund({ memberId, amount, reason, recordedBy }) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('Refund amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const refund = await Refund.create({
    member: memberId,
    amount: normalizedAmount,
    reason: reason?.trim() || '',
    recordedBy: recordedBy?.trim() || 'Admin',
    status: 'pending',
  });

  return refund;
}

async function updateRefundStatus(refundId, status, adminNote = '') {
  const allowedStatuses = ['pending', 'processing', 'completed'];
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid refund status.');
    error.status = 400;
    throw error;
  }

  const refund = await Refund.findById(refundId);
  if (!refund) {
    const error = new Error('Refund record not found.');
    error.status = 404;
    throw error;
  }

  const previousStatus = refund.status;
  refund.status = status;
  refund.adminNote = adminNote?.trim() || refund.adminNote || '';

  if (status === 'completed' && previousStatus !== 'completed') {
    const member = await User.findById(refund.member);
    if (member) {
      member.savings = Math.max(Number(member.savings) - Number(refund.amount), 0);
      await member.save();
    }
  }

  await refund.save();

  const member = await User.findById(refund.member).select('name email phone');
  if (member) {
    await notifyMemberByEmailAndSms(member, {
      subject: `Refund Status: ${status}`,
      message: `Dear ${member.name}, your refund of $${Number(refund.amount).toFixed(2)} is now ${status}.`,
    });
  }

  return refund;
}

module.exports = {
  createRefund,
  getRefundsByMember,
  updateRefundStatus,
};
