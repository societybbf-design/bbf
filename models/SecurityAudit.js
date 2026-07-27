const mongoose = require('mongoose');

const SecurityAuditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    index: true,
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  actorEmail: {
    type: String,
    trim: true,
    default: '',
  },
  actorRole: {
    type: String,
    trim: true,
    default: '',
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  targetEmail: {
    type: String,
    trim: true,
    default: '',
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ip: {
    type: String,
    trim: true,
    default: '',
  },
  success: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('SecurityAudit', SecurityAuditSchema);
