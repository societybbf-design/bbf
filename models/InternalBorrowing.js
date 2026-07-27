const mongoose = require('mongoose');

/**
 * Internal advance lending between members to cover unpaid project shares.
 * When the borrower repays, funds settle back to the lender's advanceBalance.
 */
const InternalBorrowingSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null,
    index: true,
  },
  contribution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InvestmentContribution',
    default: null,
    index: true,
  },
  lender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  lenderName: {
    type: String,
    trim: true,
    default: '',
  },
  borrower: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  borrowerName: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  amountSettled: {
    type: Number,
    default: 0,
    min: 0,
  },
  status: {
    type: String,
    enum: ['open', 'partial', 'settled', 'cancelled'],
    default: 'open',
    index: true,
  },
  note: {
    type: String,
    trim: true,
    default: '',
  },
  createdBy: {
    type: String,
    trim: true,
    default: '',
  },
  settledAt: {
    type: Date,
    default: null,
  },
  repaymentDeposit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deposit',
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

InternalBorrowingSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

InternalBorrowingSchema.virtual('outstanding').get(function outstanding() {
  return Math.max(0, Number((Number(this.amount || 0) - Number(this.amountSettled || 0)).toFixed(2)));
});

InternalBorrowingSchema.set('toJSON', { virtuals: true });
InternalBorrowingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('InternalBorrowing', InternalBorrowingSchema);
