'use strict';

const mongoose = require('mongoose');

/** Idempotency keys for investment close / Record & Distribute Profit. */
const ProfitCloseIdempotencySchema = new mongoose.Schema({
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
  investmentCode: {
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

ProfitCloseIdempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

module.exports = mongoose.model('ProfitCloseIdempotency', ProfitCloseIdempotencySchema);
