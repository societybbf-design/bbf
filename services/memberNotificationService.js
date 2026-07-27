const MemberNotification = require('../models/MemberNotification');

async function createMemberNotification({
  memberId,
  type = 'general',
  title,
  message = '',
  relatedId = null,
  relatedModel = '',
}) {
  if (!memberId || !title?.trim()) {
    return null;
  }

  return MemberNotification.create({
    member: memberId,
    type,
    title: title.trim(),
    message: message?.trim() || '',
    relatedId,
    relatedModel,
  });
}

async function getMemberNotifications(memberId, limit = 30) {
  return MemberNotification.find({ member: memberId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getUnreadMemberNotificationCount(memberId) {
  return MemberNotification.countDocuments({ member: memberId, read: false });
}

async function markMemberNotificationRead(memberId, notificationId) {
  return MemberNotification.findOneAndUpdate(
    { _id: notificationId, member: memberId },
    { read: true },
    { new: true }
  );
}

async function markAllMemberNotificationsRead(memberId) {
  await MemberNotification.updateMany({ member: memberId, read: false }, { read: true });
  return { success: true };
}

module.exports = {
  createMemberNotification,
  getMemberNotifications,
  getUnreadMemberNotificationCount,
  markMemberNotificationRead,
  markAllMemberNotificationsRead,
};
