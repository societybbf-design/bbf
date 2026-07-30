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
    enum: ['pending', 'approved', 'rejected', 'disbursed', 'completed'],
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
  /**
   * How the disbursement was funded at payout time.
   * reserve = Emergency/Reserve Fund; advance = internal borrow;
   * mixed = advance + reserve. "bank" is legacy only — new loans never use book balance.
   */
  fundingSource: {
    type: String,
    enum: ['', 'bank', 'reserve', 'advance', 'mixed'],
    default: '',
    index: true,
  },
  /** Amount allocated from Emergency / Reserve Fund for this loan (never via book). */
  fundingReserveAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Remaining reserve amount still to replenish on repayment. */
  fundingReserveOutstanding: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Amount allocated from member advance (internal borrow) for this loan. */
  fundingAdvanceAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  fundingLenderName: {
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
  /** Legacy field — installment schedules are no longer generated or used. */
  installmentMonths: {
    type: Number,
    required: false,
    min: 1,
    max: 120,
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

/** At most one live (pending/approved) application per member — blocks duplicate apply races. */
LoanApplicationSchema.index(
  { member: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'approved'] },
      autoRejected: false,
    },
    name: 'uniq_active_loan_per_member',
  }
);

module.exports = mongoose.model('LoanApplication', LoanApplicationSchema);
