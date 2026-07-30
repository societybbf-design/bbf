const mongoose = require('mongoose');

const MemberShareSchema = new mongoose.Schema({
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
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  previousProfit: {
    type: Number,
    default: 0,
  },
  newProfit: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const InvestmentProfitSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  investmentCode: {
    type: String,
    required: true,
    trim: true,
    index: true,
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
  investmentAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  saleAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  profitAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  /** Absolute loss when outcomeType is loss; otherwise 0. */
  lossAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Principal closed in this transaction (supports partial liquidation). */
  principalClosed: {
    type: Number,
    default: 0,
    min: 0,
  },
  remainingPrincipalAfter: {
    type: Number,
    default: 0,
    min: 0,
  },
  isPartial: {
    type: Boolean,
    default: false,
    index: true,
  },
  outcomeType: {
    type: String,
    enum: ['profit', 'loss', 'break_even'],
    default: 'profit',
    index: true,
  },
  distributionType: {
    type: String,
    enum: ['equal', 'proportional', 'balance'],
    default: 'equal',
  },
  memberCount: {
    type: Number,
    default: 0,
  },
  shares: [MemberShareSchema],
  societyProfitShare: {
    type: Number,
    default: 0,
  },
  investorProfitShare: {
    type: Number,
    default: 0,
  },
  societyOwnershipPct: {
    type: Number,
    default: 100,
  },
  investorOwnershipPct: {
    type: Number,
    default: 0,
  },
  distributionKind: {
    type: String,
    enum: ['sale', 'monthly_return', 'loss'],
    default: 'sale',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  recordedBy: {
    type: String,
    trim: true,
    default: 'Admin',
  },
  recordedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  clientRequestId: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  bankLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
  },
  /** Snapshot of close math for audit (principal, pnl, shares summary). */
  breakdown: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('InvestmentProfit', InvestmentProfitSchema);
