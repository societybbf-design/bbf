const mongoose = require('mongoose');

const LoanApplicationSchema = new mongoose.Schema({
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
  loanType: {
    type: String,
    enum: ['general', 'emergency'],
    default: 'general',
    index: true,
  },
  reason: {
    type: String,
    trim: true,
    default: '',
  },
  witnessName: {
    type: String,
    trim: true,
    default: '',
  },
  witnessPhone: {
    type: String,
    trim: true,
    default: '',
  },
  witnessRelation: {
    type: String,
    trim: true,
    default: '',
  },
  documents: [{
    originalName: { type: String, trim: true, default: '' },
    filePath: { type: String, trim: true, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'disbursed'],
    default: 'pending',
  },
  memberSavingsAtApply: {
    type: Number,
    default: 0,
  },
  maxEligibleAmount: {
    type: Number,
    default: 0,
  },
  autoRejected: {
    type: Boolean,
    default: false,
  },
  rejectionReason: {
    type: String,
    trim: true,
    default: '',
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
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'mobile_banking', 'check', 'other', ''],
    default: '',
  },
  contractPath: {
    type: String,
    trim: true,
    default: '',
  },
  contractGeneratedAt: {
    type: Date,
    default: null,
  },
  signedContractPath: {
    type: String,
    trim: true,
    default: '',
  },
  signedContractUploadedAt: {
    type: Date,
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  disbursedAt: {
    type: Date,
    default: null,
  },
  disbursedBy: {
    type: String,
    trim: true,
    default: '',
  },
  disbursementReference: {
    type: String,
    trim: true,
    default: '',
  },
  disbursementNote: {
    type: String,
    trim: true,
    default: '',
  },
  outstandingBalance: {
    type: Number,
    default: 0,
  },
  totalRepaid: {
    type: Number,
    default: 0,
  },
  repaymentStatus: {
    type: String,
    enum: ['none', 'active', 'paid_off'],
    default: 'none',
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

LoanApplicationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('LoanApplication', LoanApplicationSchema);
