const { formatMoney } = require('./moneyFormat');
const Refund = require('../models/Refund');
const User = require('../models/User');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { createAdminNotification } = require('./adminNotificationService');
const { recordAdminActivity } = require('./activityLogService');

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
    await createMemberNotification({
      memberId: member._id,
      type: 'refund',
      title: `Refund ${status}`,
      message: `Your refund of ${formatMoney(Number(refund.amount), 2)} is now ${status}.`,
      relatedId: refund._id,
      relatedModel: 'Refund',
    });
    await notifyMemberByEmailAndSms(member, {
      subject: `Refund Status: ${status}`,
      message: `Dear ${member.name}, your refund of ${formatMoney(Number(refund.amount), 2)} is now ${status}.`,
    });
    if (status === 'completed' && previousStatus !== 'completed') {
      await createAdminNotification({
        type: 'refund',
        title: `Refund completed for ${member.name}`,
        message: `Refund of ${formatMoney(Number(refund.amount), 2)} completed.`,
        relatedId: refund._id,
        relatedModel: 'Refund',
        targetRoles: ['ceo', 'cashier'],
      });
    }
  }

  return refund;
}

async function updateRefundStatusWithAudit(refundId, status, adminNote = '', options = {}) {
  const refund = await updateRefundStatus(refundId, status, adminNote);
  if (status === 'completed') {
    await recordAdminActivity({
      action: 'refund_completed',
      actor: options.actor || null,
      targetUserId: refund.member,
      details: {
        amount: refund.amount,
        refundId: refund._id,
      },
      ip: options.ip || '',
    });
  }
  return refund;
}

module.exports = {
  createRefund,
  getRefundsByMember,
  updateRefundStatus,
  updateRefundStatusWithAudit,
};
