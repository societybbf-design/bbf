const mongoose = require('mongoose');

const MemberNotificationSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['loan', 'repayment', 'kyc', 'withdrawal', 'deposit', 'dividend', 'refund', 'general'],
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

module.exports = mongoose.model('MemberNotification', MemberNotificationSchema);
