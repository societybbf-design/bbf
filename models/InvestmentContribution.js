const mongoose = require('mongoose');

/**
 * Per-member share of an investment funding round.
 * Unpaid members are flagged but do not block project payout.
 */
const InvestmentContributionSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  memberName: {
    type: String,
    trim: true,
    default: '',
  },
  expectedAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  paidFromSavings: {
    type: Number,
    default: 0,
    min: 0,
  },
  paidFromAdvance: {
    type: Number,
    default: 0,
    min: 0,
  },
  borrowedAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  unpaidAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  status: {
    type: String,
    enum: ['paid', 'unpaid', 'covered_by_borrow', 'settled'],
    default: 'unpaid',
    index: true,
  },
  borrowing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InternalBorrowing',
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

InvestmentContributionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

InvestmentContributionSchema.index({ investment: 1, member: 1 }, { unique: true });

module.exports = mongoose.model('InvestmentContribution', InvestmentContributionSchema);
