const mongoose = require('mongoose');

const ExitApprovalSchema = new mongoose.Schema({
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

const RedistributionShareSchema = new mongoose.Schema({
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
  weight: {
    type: Number,
    default: 0,
  },
  savingsCredit: {
    type: Number,
    default: 0,
    min: 0,
  },
  profitCredit: {
    type: Number,
    default: 0,
    min: 0,
  },
  advanceCredit: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalCredit: {
    type: Number,
    default: 0,
    min: 0,
  },
}, { _id: false });

/**
 * Multi-approval member exit with share redistribution and Cashier payout.
 * Flow: pending_departing_approval → pending_member_approval → pending_cashier_payment → completed
 */
const MemberExitRequestSchema = new mongoose.Schema({
  departingMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  departingMemberName: {
    type: String,
    trim: true,
    default: '',
  },
  departingMemberEmail: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: [
      'pending_departing_approval',
      'pending_member_approval',
      'pending_cashier_payment',
      'completed',
      'cancelled',
      'rejected',
    ],
    default: 'pending_departing_approval',
    index: true,
  },
  settlementAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  settlementBreakdown: {
    savings: { type: Number, default: 0, min: 0 },
    profit: { type: Number, default: 0, min: 0 },
    advance: { type: Number, default: 0, min: 0 },
  },
  /** Remaining active members who must approve redistribution (after departing approves). */
  eligibleMembers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  redistributionPlan: [RedistributionShareSchema],
  departingApproval: {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    memberName: { type: String, trim: true, default: '' },
    approvedAt: { type: Date, default: null },
  },
  memberApprovals: [ExitApprovalSchema],
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  initiatedBy: {
    type: String,
    trim: true,
    default: '',
  },
  initiatedAt: {
    type: Date,
    default: Date.now,
  },
  rejectedBy: {
    type: String,
    trim: true,
    default: '',
  },
  rejectionReason: {
    type: String,
    trim: true,
    default: '',
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
  paymentMethod: {
    type: String,
    trim: true,
    default: '',
  },
  transferReference: {
    type: String,
    trim: true,
    default: '',
  },
  exitDepositId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deposit',
    default: null,
  },
  bankLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
  },
}, {
  timestamps: true,
});

MemberExitRequestSchema.index({ status: 1, createdAt: -1 });
MemberExitRequestSchema.index({ departingMember: 1, status: 1 });

module.exports = mongoose.model('MemberExitRequest', MemberExitRequestSchema);
