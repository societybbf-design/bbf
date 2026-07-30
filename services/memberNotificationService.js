const MemberNotification = require('../models/MemberNotification');
const {
  sectionForNotification,
  enrichNotificationForViewer,
} = require('./notificationLinkService');

async function createMemberNotification({
  memberId,
  type = 'general',
  title,
  message = '',
  relatedId = null,
  relatedModel = '',
  link = '',
}) {
  if (!memberId || !title?.trim()) {
    return null;
  }

  const resolvedLink = sectionForNotification({
    type,
    relatedModel,
    title,
    link,
  });

  return MemberNotification.create({
    member: memberId,
    type,
    title: title.trim(),
    message: message?.trim() || '',
    relatedId,
    relatedModel,
    link: resolvedLink,
  });
}

async function getMemberNotifications(memberId, limit = 30) {
  const docs = await MemberNotification.find({ member: memberId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((doc) => enrichNotificationForViewer(doc, 'member'));
}

async function getUnreadMemberNotificationCount(memberId) {
  return MemberNotification.countDocuments({ member: memberId, read: false });
}

async function markMemberNotificationRead(memberId, notificationId) {
  const notification = await MemberNotification.findOneAndUpdate(
    { _id: notificationId, member: memberId },
    { read: true },
    { new: true }
  );
  if (!notification) return null;
  return enrichNotificationForViewer(notification.toObject(), 'member');
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
