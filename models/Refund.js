const mongoose = require('mongoose');

/**
 * Maker-checker refund workflow:
 * pending (member request) → approved | rejected (CEO) → completed (Cashier payout)
 * Legacy status "processing" is treated as approved for migration.
 */
const RefundSchema = new mongoose.Schema({
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
  },
  reason: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed', 'processing'],
    default: 'pending',
    index: true,
  },
  adminNote: {
    type: String,
    trim: true,
    default: '',
  },
  recordedBy: {
    type: String,
    trim: true,
    default: '',
  },
  requestedBy: {
    type: String,
    enum: ['member', 'staff_legacy'],
    default: 'member',
  },
  reviewedBy: {
    type: String,
    trim: true,
    default: '',
  },
  reviewedAt: {
    type: Date,
    default: null,
  },
  paymentMethod: {
    type: String,
    trim: true,
    default: '',
  },
  disbursementReference: {
    type: String,
    trim: true,
    default: '',
  },
  processedBy: {
    type: String,
    trim: true,
    default: '',
  },
  processedAt: {
    type: Date,
    default: null,
  },
  bankLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
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

RefundSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

RefundSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Refund', RefundSchema);
