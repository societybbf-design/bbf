const mongoose = require('mongoose');

const ChatAttachmentSchema = new mongoose.Schema({
  originalName: { type: String, trim: true, default: '' },
  filePath: { type: String, trim: true, required: true },
  mimeType: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const StaffChatMessageSchema = new mongoose.Schema({
  conversationKey: {
    type: String,
    required: true,
    index: true,
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }],
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  senderName: {
    type: String,
    trim: true,
    default: '',
  },
  senderRole: {
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
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffChatMessage',
    default: null,
  },
  attachments: {
    type: [ChatAttachmentSchema],
    default: [],
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

StaffChatMessageSchema.index({ participants: 1, createdAt: -1 });

module.exports = mongoose.model('StaffChatMessage', StaffChatMessageSchema);
