'use strict';

const mongoose = require('mongoose');

/**
 * Short-lived keys that make cashier deposit POSTs safe to retry.
 * Completed responses are replayed; in-flight keys reject concurrent duplicates.
 */
const DepositIdempotencySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 128,
    index: true,
  },
  actorId: {
    type: String,
    trim: true,
    default: '',
  },
  memberId: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing',
    index: true,
  },
  responseStatus: {
    type: Number,
    default: 201,
  },
  responseBody: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
    default: null,
  },
});

DepositIdempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

module.exports = mongoose.model('DepositIdempotency', DepositIdempotencySchema);
