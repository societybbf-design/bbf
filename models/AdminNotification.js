const mongoose = require('mongoose');

const AdminNotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['loan', 'kyc', 'withdrawal', 'deposit', 'dividend', 'refund', 'general'],
    default: 'general',
    index: true,
  },
  title: {
    type: String,
    trim: true,
    required: true,
  },
  message: {
    type: String,
    trim: true,
    default: '',
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  relatedModel: {
    type: String,
    trim: true,
    default: '',
  },
  /** Optional single staff user recipient (targeted). */
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  /** Optional role audience, e.g. ['ceo'], ['cashier']. Empty + no targetUser = legacy broadcast. */
  targetRoles: {
    type: [String],
    default: [],
    index: true,
  },
  /** Per-user read receipts — preferred over shared `read`. */
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  /** Legacy shared read flag (kept for older documents). */
  read: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('AdminNotification', AdminNotificationSchema);
