const mongoose = require('mongoose');

const WithdrawalRequestSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  reason: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'processed', 'rejected'],
    default: 'pending',
  },
  adminNote: {
    type: String,
    trim: true,
    default: '',
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank', 'mfs', ''],
    default: '',
  },
  disbursementReference: {
    type: String,
    trim: true,
    default: '',
  },
  processedAt: {
    type: Date,
    default: null,
  },
  processedBy: {
    type: String,
    trim: true,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

WithdrawalRequestSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('WithdrawalRequest', WithdrawalRequestSchema);
