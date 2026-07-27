const mongoose = require('mongoose');

/**
 * Per-member monthly fixed-contribution obligation against that month's target.
 * Integrates with advance surplus routing and unpaid / borrowing tracking.
 */
const MonthlyContributionDueSchema = new mongoose.Schema({
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
  yearMonth: {
    type: String,
    required: true,
    trim: true,
    match: /^\d{4}-\d{2}$/,
    index: true,
  },
  expectedAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  unpaidAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  surplusToAdvance: {
    type: Number,
    default: 0,
    min: 0,
  },
  status: {
    type: String,
    enum: ['paid', 'partial', 'unpaid', 'settled'],
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

MonthlyContributionDueSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

MonthlyContributionDueSchema.index({ member: 1, yearMonth: 1 }, { unique: true });
MonthlyContributionDueSchema.index({ yearMonth: 1, status: 1 });

module.exports = mongoose.model('MonthlyContributionDue', MonthlyContributionDueSchema);
