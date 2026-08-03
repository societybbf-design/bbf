const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const StaffChatMessage = require('../models/StaffChatMessage');
const User = require('../models/User');
const { saveUploadedFiles } = require('../middleware/upload');
const { normalizeRole, ROLE_LABELS } = require('./rbac');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
const STAFF_CHAT_ROLES = ['ceo', 'cashier', 'project_manager', 'employee', 'developer', 'admin'];
/** Roles allowed as peers/senders for External Investor ↔ CEO/PM messaging. */
const EXTERNAL_CHAT_PEER_ROLES = ['ceo', 'admin', 'project_manager', 'external_investor'];

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

function staffConversationKey(userA, userB) {
  return [String(userA), String(userB)].sort().join(':');
}

function serializeStaffMessage(doc) {
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
    conversationKey: plain.conversationKey,
    participants: plain.participants || [],
    senderRole: plain.senderRole || 'staff',
    senderId: plain.senderId,
    senderName: plain.senderName || '',
    body: plain.body || '',
    replyTo: reply,
    attachments: Array.isArray(plain.attachments) ? plain.attachments : [],
    readBy: Array.isArray(plain.readBy) ? plain.readBy : [],
    createdAt: plain.createdAt,
  };
}

async function assertStaffPeer(userId) {
  const user = await User.findById(userId).select('name email role status');
  if (!user) throw httpError('Staff user not found.', 404);
  const role = normalizeRole(user.role);
  const rawRole = String(user.role || '').toLowerCase();
  const allowed = STAFF_CHAT_ROLES.includes(role)
    || rawRole === 'external_investor'
    || EXTERNAL_CHAT_PEER_ROLES.includes(rawRole);
  if (!allowed) {
    throw httpError('Selected user is not available for staff messaging.', 400);
  }
  if (user.status === 'deleted') {
    throw httpError('This staff account is no longer active.', 403);
  }
  return user;
}

async function getStaffChatDirectory(viewer) {
  const viewerId = String(viewer?.id || viewer?._id || '');
  const viewerRole = normalizeRole(viewer?.role);
  const roleFilter = [...STAFF_CHAT_ROLES];
  // CEO/admin can message External Investors; PMs see external investors on their projects via portal.
  if (viewerRole === 'ceo' || String(viewer?.role || '').toLowerCase() === 'admin') {
    roleFilter.push('external_investor');
  }
  const peers = await User.find({
    role: { $in: roleFilter },
    status: { $in: ['active', 'inactive'] },
    _id: { $ne: viewerId },
  })
    .select('name email role status')
    .sort({ name: 1 })
    .lean();

  const keys = peers.map((peer) => staffConversationKey(viewerId, peer._id));
  const latestByKey = new Map();
  const unreadByKey = new Map();

  if (keys.length) {
    const viewerObjectId = new mongoose.Types.ObjectId(String(viewerId));
    const recent = await StaffChatMessage.aggregate([
      { $match: { conversationKey: { $in: keys } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationKey',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$senderId', viewerObjectId] },
                    { $not: [{ $in: [viewerObjectId, { $ifNull: ['$readBy', []] }] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    recent.forEach((row) => {
      latestByKey.set(row._id, serializeStaffMessage(row.lastMessage));
      unreadByKey.set(row._id, row.unreadCount || 0);
    });
  }

  return peers.map((peer) => {
    const key = staffConversationKey(viewerId, peer._id);
    const role = normalizeRole(peer.role);
    return {
      userId: peer._id,
      user: {
        ...peer,
        role,
        roleLabel: ROLE_LABELS[role] || role,
      },
      conversationKey: key,
      lastMessage: latestByKey.get(key) || null,
      unreadCount: unreadByKey.get(key) || 0,
    };
  }).sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.user?.name || '').localeCompare(String(b.user?.name || ''));
  });
}

async function getStaffMessages(viewerId, peerId, { limit = 200 } = {}) {
  await assertStaffPeer(peerId);
  const key = staffConversationKey(viewerId, peerId);
  const messages = await StaffChatMessage.find({ conversationKey: key })
    .sort({ createdAt: 1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .populate('replyTo', 'body senderName senderRole attachments createdAt')
    .lean();
  return messages.map(serializeStaffMessage);
}

async function markStaffMessagesRead(viewerId, peerId) {
  const key = staffConversationKey(viewerId, peerId);
  await StaffChatMessage.updateMany(
    {
      conversationKey: key,
      senderId: { $ne: viewerId },
      readBy: { $ne: viewerId },
    },
    { $addToSet: { readBy: viewerId } }
  );
  return { success: true };
}

async function sendStaffMessage({
  sender,
  peerId,
  body = '',
  replyTo = null,
  files = [],
}) {
  const senderId = sender?.id || sender?._id;
  if (!senderId) throw httpError('Authentication required.', 401);
  if (String(senderId) === String(peerId)) {
    throw httpError('You cannot message yourself.', 400);
  }

  const peer = await assertStaffPeer(peerId);
  const senderRawRole = String(sender.role || '').toLowerCase();
  const senderRole = normalizeRole(sender.role);
  const peerRawRole = String(peer.role || '').toLowerCase();
  const peerRole = normalizeRole(peer.role);
  const senderOk = STAFF_CHAT_ROLES.includes(senderRole) || senderRawRole === 'external_investor';
  if (!senderOk) {
    throw httpError('Your role cannot use staff messaging.', 403);
  }
  // External investors may only message CEO/admin or Project Managers.
  if (senderRawRole === 'external_investor') {
    if (!['ceo', 'admin', 'project_manager'].includes(peerRawRole) && peerRole !== 'ceo') {
      throw httpError('External Investors can only message the CEO or their Project Manager.', 403);
    }
  }
  // Staff messaging an external investor: only CEO/admin (or PM) may initiate.
  if (peerRawRole === 'external_investor') {
    if (!['ceo', 'admin', 'project_manager'].includes(senderRawRole) && senderRole !== 'ceo') {
      throw httpError('Only the CEO or Project Manager can message External Investors.', 403);
    }
  }

  const trimmedBody = String(body || '').trim();
  const incomingFiles = normalizeIncomingFiles(files);
  if (!trimmedBody && !incomingFiles.length) {
    throw httpError('Message cannot be empty. Add text or an attachment.');
  }
  if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
    throw httpError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const key = staffConversationKey(senderId, peerId);
  let replyToId = null;
  if (replyTo) {
    const parent = await StaffChatMessage.findOne({ _id: replyTo, conversationKey: key }).select('_id');
    if (!parent) throw httpError('The message you are replying to was not found in this conversation.');
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

  const message = await StaffChatMessage.create({
    conversationKey: key,
    participants: [senderId, peerId],
    senderId,
    senderName: sender.name || ROLE_LABELS[senderRole] || 'Staff',
    senderRole,
    body: trimmedBody || (attachments.length ? 'Shared an attachment' : ''),
    replyTo: replyToId,
    attachments,
    readBy: [senderId],
  });

  const populated = await StaffChatMessage.findById(message._id)
    .populate('replyTo', 'body senderName senderRole attachments createdAt');

  return serializeStaffMessage(populated);
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  STAFF_CHAT_ROLES,
  EXTERNAL_CHAT_PEER_ROLES,
  serializeMessage,
  getMessagesForMember,
  markMessagesReadForAdmin,
  markMessagesReadForMember,
  getUnreadCountForAdmin,
  getUnreadCountForMember,
  sendMessage,
  getAdminInbox,
  getChatDirectory,
  getStaffChatDirectory,
  getStaffMessages,
  markStaffMessagesRead,
  sendStaffMessage,
};
