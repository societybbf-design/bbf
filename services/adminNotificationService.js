const AdminNotification = require('../models/AdminNotification');

async function createAdminNotification({
  type = 'general',
  title,
  message = '',
  relatedId = null,
  relatedModel = '',
}) {
  if (!title?.trim()) {
    return null;
  }

  return AdminNotification.create({
    type,
    title: title.trim(),
    message: message.trim(),
    relatedId,
    relatedModel,
    read: false,
  });
}

async function getAdminNotifications(limit = 30) {
  return AdminNotification.find({}).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getUnreadNotificationCount() {
  return AdminNotification.countDocuments({ read: false });
}

async function markNotificationRead(notificationId) {
  return AdminNotification.findByIdAndUpdate(
    notificationId,
    { read: true },
    { new: true }
  );
}

async function markAllNotificationsRead() {
  await AdminNotification.updateMany({ read: false }, { read: true });
  return { success: true };
}

module.exports = {
  createAdminNotification,
  getAdminNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
};
