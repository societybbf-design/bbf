const AdminNotification = require('../models/AdminNotification');
const { normalizeRole } = require('./rbac');

function viewerId(user) {
  return user?.id || user?._id || null;
}

function viewerRole(user) {
  return normalizeRole(user?.role || '');
}

/**
 * Audience filter: targeted user, matching role, or legacy unscoped docs.
 */
function buildAudienceFilter(user) {
  const id = viewerId(user);
  const role = viewerRole(user);
  const clauses = [
    {
      $and: [
        { $or: [{ targetUser: null }, { targetUser: { $exists: false } }] },
        {
          $or: [
            { targetRoles: { $exists: false } },
            { targetRoles: { $size: 0 } },
            { targetRoles: null },
          ],
        },
      ],
    },
  ];
  if (id) {
    clauses.unshift({ targetUser: id });
  }
  if (role) {
    clauses.unshift({ targetRoles: role });
  }
  return { $or: clauses };
}

function withPersonalRead(doc, user) {
  const id = String(viewerId(user) || '');
  const readBy = Array.isArray(doc.readBy) ? doc.readBy.map((item) => String(item)) : [];
  if (id && readBy.includes(id)) {
    return { ...doc, read: true };
  }
  const isLegacyBroadcast = !doc.targetUser && !(doc.targetRoles || []).length;
  if (isLegacyBroadcast && readBy.length === 0) {
    return { ...doc, read: Boolean(doc.read) };
  }
  return { ...doc, read: false };
}

async function createAdminNotification({
  type = 'general',
  title,
  message = '',
  relatedId = null,
  relatedModel = '',
  targetUser = null,
  targetRoles = [],
}) {
  if (!title?.trim()) {
    return null;
  }

  const roles = Array.isArray(targetRoles)
    ? [...new Set(targetRoles.map((role) => normalizeRole(role)).filter(Boolean))]
    : [];

  return AdminNotification.create({
    type,
    title: title.trim(),
    message: message.trim(),
    relatedId,
    relatedModel,
    targetUser: targetUser || null,
    targetRoles: roles,
    readBy: [],
    read: false,
  });
}

async function getAdminNotifications(user, limit = 30) {
  const docs = await AdminNotification.find(buildAudienceFilter(user))
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((doc) => withPersonalRead(doc, user));
}

async function getUnreadNotificationCount(user) {
  const id = viewerId(user);
  if (!id) return 0;
  const docs = await AdminNotification.find(buildAudienceFilter(user))
    .select('read readBy targetUser targetRoles')
    .lean();
  return docs.filter((doc) => !withPersonalRead(doc, user).read).length;
}

async function markNotificationRead(notificationId, user) {
  const id = viewerId(user);
  if (!id) return null;
  const notification = await AdminNotification.findOne({
    _id: notificationId,
    ...buildAudienceFilter(user),
  });
  if (!notification) return null;
  const already = (notification.readBy || []).some((item) => String(item) === String(id));
  if (!already) {
    notification.readBy = [...(notification.readBy || []), id];
    await notification.save();
  }
  return withPersonalRead(notification.toObject(), user);
}

async function markAllNotificationsRead(user) {
  const id = viewerId(user);
  if (!id) return { success: false };
  const docs = await AdminNotification.find(buildAudienceFilter(user)).select('_id readBy');
  await Promise.all(docs.map(async (doc) => {
    const already = (doc.readBy || []).some((item) => String(item) === String(id));
    if (!already) {
      doc.readBy = [...(doc.readBy || []), id];
      await doc.save();
    }
  }));
  return { success: true };
}

module.exports = {
  createAdminNotification,
  getAdminNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  buildAudienceFilter,
};
