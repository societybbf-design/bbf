const mongoose = require('mongoose');

/**
 * Mandatory fixed deposit target for a specific calendar month (YYYY-MM).
 * Replaces the single lifelong MONTHLY_CONTRIBUTION env amount for per-month control.
 */
const MonthlyContributionTargetSchema = new mongoose.Schema({
  yearMonth: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    match: /^\d{4}-\d{2}$/,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  setBy: {
    type: String,
    trim: true,
    default: '',
  },
  setAt: {
    type: Date,
    default: Date.now,
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

MonthlyContributionTargetSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('MonthlyContributionTarget', MonthlyContributionTargetSchema);
