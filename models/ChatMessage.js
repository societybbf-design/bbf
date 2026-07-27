const mongoose = require('mongoose');

const ChatAttachmentSchema = new mongoose.Schema({
  originalName: { type: String, trim: true, default: '' },
  filePath: { type: String, trim: true, required: true },
  mimeType: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const ChatMessageSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  senderRole: {
    type: String,
    enum: ['admin', 'member'],
    required: true,
    index: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  senderName: {
    type: String,
    trim: true,
    default: '',
  },
  body: {
    type: String,
    trim: true,
    default: '',
    maxlength: 2000,
  },
  /** Reply threading — points at the message being answered */
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatMessage',
    default: null,
    index: true,
  },
  attachments: {
    type: [ChatAttachmentSchema],
    default: [],
  },
  readByAdmin: {
    type: Boolean,
    default: false,
    index: true,
  },
  readByMember: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
