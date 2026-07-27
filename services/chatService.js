const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { saveUploadedFiles } = require('../middleware/upload');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function serializeMessage(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const reply = plain.replyTo && typeof plain.replyTo === 'object' && plain.replyTo._id
    ? {
      id: plain.replyTo._id,
      body: plain.replyTo.body || '',
      senderName: plain.replyTo.senderName || '',
      senderRole: plain.replyTo.senderRole || '',
      hasAttachments: Array.isArray(plain.replyTo.attachments) && plain.replyTo.attachments.length > 0,
      createdAt: plain.replyTo.createdAt,
    }
    : plain.replyTo
      ? { id: plain.replyTo }
      : null;

  return {
    id: plain._id,
    _id: plain._id,
    member: plain.member,
    senderRole: plain.senderRole,
    senderId: plain.senderId,
    senderName: plain.senderName || '',
    body: plain.body || '',
    replyTo: reply,
    attachments: Array.isArray(plain.attachments) ? plain.attachments : [],
    readByAdmin: Boolean(plain.readByAdmin),
    readByMember: Boolean(plain.readByMember),
    createdAt: plain.createdAt,
  };
}

async function assertActiveMember(memberId) {
  const member = await User.findOne({ _id: memberId, role: 'member' }).select('name email status');
  if (!member) {
    throw httpError('Member not found.', 404);
  }
  if (member.status === 'deleted') {
    throw httpError('This member is no longer in the society.', 403);
  }
  return member;
}

function normalizeIncomingFiles(files = []) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, MAX_ATTACHMENTS).map((file) => {
    const data = String(file?.data || '');
    const approxBytes = Math.floor((data.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      throw httpError(`Each attachment must be under ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(1)} MB.`);
    }
    return {
      name: file.name || file.originalName || 'file',
      data,
      mimeType: file.mimeType || file.type || '',
      size: file.size || approxBytes,
    };
  }).filter((f) => f.data && f.name);
}

async function getMessagesForMember(memberId, { limit = 200 } = {}) {
  const messages = await ChatMessage.find({ member: memberId })
    .sort({ createdAt: 1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .populate('replyTo', 'body senderName senderRole attachments createdAt')
    .lean();
  return messages.map(serializeMessage);
}

async function markMessagesReadForAdmin(memberId) {
  await ChatMessage.updateMany(
    { member: memberId, senderRole: 'member', readByAdmin: false },
    { readByAdmin: true }
  );
  return { success: true };
}

async function markMessagesReadForMember(memberId) {
  await ChatMessage.updateMany(
    { member: memberId, senderRole: 'admin', readByMember: false },
    { readByMember: true }
  );
  return { success: true };
}

async function getUnreadCountForAdmin(memberId) {
  return ChatMessage.countDocuments({
    member: memberId,
    senderRole: 'member',
    readByAdmin: false,
  });
}

async function getUnreadCountForMember(memberId) {
  return ChatMessage.countDocuments({
    member: memberId,
    senderRole: 'admin',
    readByMember: false,
  });
}

async function sendMessage({
  memberId,
  senderRole,
  senderId,
  senderName = '',
  body = '',
  replyTo = null,
  files = [],
}) {
  const trimmedBody = String(body || '').trim();
  const incomingFiles = normalizeIncomingFiles(files);

  if (!trimmedBody && !incomingFiles.length) {
    throw httpError('Message cannot be empty. Add text or an attachment.');
  }
  if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
    throw httpError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const member = await assertActiveMember(memberId);
  const normalizedRole = senderRole === 'admin' ? 'admin' : 'member';

  if (normalizedRole === 'member' && String(senderId) !== String(memberId)) {
    throw httpError('Forbidden.', 403);
  }

  if (normalizedRole === 'member' && member.status === 'inactive') {
    throw httpError('Inactive members cannot send messages.', 403);
  }

  let replyToId = null;
  if (replyTo) {
    const parent = await ChatMessage.findOne({ _id: replyTo, member: memberId }).select('_id');
    if (!parent) {
      throw httpError('The message you are replying to was not found in this conversation.');
    }
    replyToId = parent._id;
  }

  const savedFiles = saveUploadedFiles(
    incomingFiles.map((f) => ({ name: f.name, data: f.data })),
    'chat'
  );
  const attachments = savedFiles.map((file, index) => ({
    originalName: file.originalName,
    filePath: file.filePath,
    mimeType: incomingFiles[index]?.mimeType || '',
    size: incomingFiles[index]?.size || 0,
    uploadedAt: file.uploadedAt,
  }));

  const message = await ChatMessage.create({
    member: memberId,
    senderRole: normalizedRole,
    senderId,
    senderName: senderName?.trim() || (normalizedRole === 'admin' ? 'Cashier' : member.name),
    body: trimmedBody || (attachments.length ? 'Shared an attachment' : ''),
    replyTo: replyToId,
    attachments,
    readByAdmin: normalizedRole === 'admin',
    readByMember: normalizedRole === 'member',
  });

  const populated = await ChatMessage.findById(message._id)
    .populate('replyTo', 'body senderName senderRole attachments createdAt');

  const previewBase = trimmedBody
    || (attachments.length ? `📎 ${attachments[0].originalName}` : 'New message');
  const preview = previewBase.length > 120 ? `${previewBase.slice(0, 117)}...` : previewBase;

  if (normalizedRole === 'member') {
    await createAdminNotification({
      type: 'general',
      title: `Message from ${member.name}`,
      message: preview,
      relatedId: memberId,
      relatedModel: 'User',
    });
  } else {
    await createMemberNotification({
      memberId,
      type: 'general',
      title: 'New message from society office',
      message: preview,
      relatedId: message._id,
      relatedModel: 'ChatMessage',
    });
  }

  return serializeMessage(populated);
}

async function getAdminInbox() {
  const rows = await ChatMessage.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$member',
        lastMessage: { $first: '$$ROOT' },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$senderRole', 'member'] }, { $eq: ['$readByAdmin', false] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { 'lastMessage.createdAt': -1 } },
    { $limit: 100 },
  ]);

  if (!rows.length) {
    return [];
  }

  const memberIds = rows.map((row) => row._id);
  const members = await User.find({ _id: { $in: memberIds } }).select('name email status').lean();
  const memberMap = new Map(members.map((item) => [String(item._id), item]));

  return rows.map((row) => ({
    memberId: row._id,
    member: memberMap.get(String(row._id)) || null,
    lastMessage: serializeMessage(row.lastMessage),
    unreadCount: row.unreadCount,
  }));
}

/**
 * Full member directory for cashier/admin messenger — includes members with no prior chat.
 */
async function getChatDirectory() {
  const [members, inbox] = await Promise.all([
    User.find({ role: 'member', status: { $in: ['active', 'inactive'] } })
      .select('name email status')
      .sort({ name: 1 })
      .lean(),
    getAdminInbox(),
  ]);

  const inboxMap = new Map(inbox.map((row) => [String(row.memberId), row]));

  return members.map((member) => {
    const existing = inboxMap.get(String(member._id));
    return {
      memberId: member._id,
      member,
      lastMessage: existing?.lastMessage || null,
      unreadCount: existing?.unreadCount || 0,
    };
  });
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  serializeMessage,
  getMessagesForMember,
  markMessagesReadForAdmin,
  markMessagesReadForMember,
  getUnreadCountForAdmin,
  getUnreadCountForMember,
  sendMessage,
  getAdminInbox,
  getChatDirectory,
};
