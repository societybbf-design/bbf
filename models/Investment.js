const mongoose = require('mongoose');

const InvestmentDocumentSchema = new mongoose.Schema({
  originalName: { type: String, trim: true, default: '' },
  filePath: { type: String, trim: true, required: true },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const InvestmentApprovalSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  memberName: {
    type: String,
    trim: true,
    default: '',
  },
  approvedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const InvestmentSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  projectManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  investmentCode: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
  },
  investmentType: {
    type: String,
    trim: true,
    default: 'Fixed Investment',
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    default: '',
  },
  dateOfBirth: {
    type: Date,
    default: null,
  },
  location: {
    type: String,
    trim: true,
    default: '',
  },
  sector: {
    type: String,
    trim: true,
    default: '',
  },
  partner: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
    default: 0,
  },
  allocation: {
    type: String,
    trim: true,
    default: '',
  },
  withdrawals: {
    type: Number,
    default: 0,
    min: 0,
  },
  profit: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: [
      'pending_member_approval',
      'pending_cashier_payment',
      'active',
      'sold',
      'rejected',
    ],
    default: 'pending_member_approval',
    index: true,
  },
  documents: {
    type: [InvestmentDocumentSchema],
    default: [],
  },
  eligibleMembers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  approvals: {
    type: [InvestmentApprovalSchema],
    default: [],
  },
  cashierNote: {
    type: String,
    trim: true,
    default: '',
  },
  cashierProcessedBy: {
    type: String,
    trim: true,
    default: '',
  },
  cashierProcessedAt: {
    type: Date,
    default: null,
  },
  payoutReceiverRole: {
    type: String,
    trim: true,
    default: '',
  },
  payoutReceiverName: {
    type: String,
    trim: true,
    default: '',
  },
  payoutReceiverEmail: {
    type: String,
    trim: true,
    default: '',
  },
  payoutAccountName: {
    type: String,
    trim: true,
    default: '',
  },
  payoutAccountNumber: {
    type: String,
    trim: true,
    default: '',
  },
  payoutBankName: {
    type: String,
    trim: true,
    default: '',
  },
  bankLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
  },
  saleAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  outcomeType: {
    type: String,
    enum: ['', 'profit', 'loss'],
    default: '',
  },
  soldAt: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  createdBy: {
    type: String,
    trim: true,
    default: 'Admin',
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

InvestmentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  if (!this.allocation) {
    this.allocation = this.sector || this.investmentType;
  }
  next();
});

module.exports = mongoose.model('Investment', InvestmentSchema);
