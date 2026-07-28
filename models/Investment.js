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
  proxiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  proxiedByName: {
    type: String,
    trim: true,
    default: '',
  },
  proxiedByRole: {
    type: String,
    trim: true,
    default: '',
  },
  proxyReason: {
    type: String,
    trim: true,
    default: '',
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
  /** Total project return style */
  returnMode: {
    type: String,
    enum: ['monthly', 'fixed_term'],
    default: 'fixed_term',
    index: true,
  },
  termMonths: {
    type: Number,
    default: null,
    min: 1,
  },
  maturityDate: {
    type: Date,
    default: null,
  },
  /** Ownership percentages must sum to 100 */
  societyOwnershipPct: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  investorOwnershipPct: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  societyAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  externalAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  externalCapitalReceived: {
    type: Number,
    default: 0,
    min: 0,
  },
  externalCapitalReceivedAt: {
    type: Date,
    default: null,
  },
  externalCapitalRecordedBy: {
    type: String,
    trim: true,
    default: '',
  },
  externalCapitalLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
  },
  /** Accumulated investor profit share (monthly returns / sale) awaiting settlement */
  investorProfitBalance: {
    type: Number,
    default: 0,
  },
  monthlyProfitTotal: {
    type: Number,
    default: 0,
    min: 0,
  },
  ledgerLockedAt: {
    type: Date,
    default: null,
  },
  ledgerLockedBy: {
    type: String,
    trim: true,
    default: '',
  },
  closedAt: {
    type: Date,
    default: null,
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
      'closed',
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
  // Keep capital legs aligned with ownership when amount is set.
  const total = Number(this.amount || 0);
  const societyPct = Number(this.societyOwnershipPct);
  const investorPct = Number(this.investorOwnershipPct);
  if (Number.isFinite(societyPct) && Number.isFinite(investorPct) && total > 0) {
    if (!this.societyAmount && societyPct >= 0) {
      this.societyAmount = Number(((total * societyPct) / 100).toFixed(2));
    }
    if (!this.externalAmount && investorPct >= 0) {
      this.externalAmount = Number((total - Number(this.societyAmount || 0)).toFixed(2));
    }
  }
  next();
});

module.exports = mongoose.model('Investment', InvestmentSchema);
