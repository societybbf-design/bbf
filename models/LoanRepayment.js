const mongoose = require('mongoose');

const LoanRepaymentSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  repaymentType: {
    type: String,
    enum: ['full', 'installment'],
    default: 'installment',
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'mobile_banking', 'check', 'other'],
    default: 'cash',
  },
  memberNote: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  adminNote: {
    type: String,
    trim: true,
    default: '',
  },
  reviewedBy: {
    type: String,
    trim: true,
    default: '',
  },
  balanceBefore: {
    type: Number,
    default: 0,
  },
  balanceAfter: {
    type: Number,
    default: 0,
  },
  receiptNumber: {
    type: String,
    trim: true,
    default: '',
  },
  receiptPath: {
    type: String,
    trim: true,
    default: '',
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  adminManual: {
    type: Boolean,
    default: false,
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

LoanRepaymentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('LoanRepayment', LoanRepaymentSchema);
