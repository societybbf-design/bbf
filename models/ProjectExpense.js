const mongoose = require('mongoose');

const ProjectExpenseAttachmentSchema = new mongoose.Schema({
  originalName: { type: String, trim: true, default: '' },
  filePath: { type: String, trim: true, required: true },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

/**
 * Project operational expense logged by the Project Manager (maker).
 * Does not debit the Society Bank Ledger until / unless CEO-approved society share execution.
 */
const ProjectExpenseSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  investmentCode: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  projectManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  description: {
    type: String,
    trim: true,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  expenseDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
  yearMonth: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  category: {
    type: String,
    trim: true,
    default: 'operational',
  },
  attachments: {
    type: [ProjectExpenseAttachmentSchema],
    default: [],
  },
  status: {
    type: String,
    enum: [
      'draft',
      'submitted',
      'pending_external_approval',
      'external_approved',
      'external_rejected',
      'ceo_approved',
      'ceo_rejected',
      'executed',
    ],
    default: 'draft',
    index: true,
  },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: String, trim: true, default: '' },
  /**
   * Per-investor approvals for the external ownership share.
   * Required before CEO can disburse from that investor's ledger.
   */
  externalApprovals: {
    type: [{
      investor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      investorName: { type: String, trim: true, default: '' },
      shareAmount: { type: Number, default: 0, min: 0 },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: String, trim: true, default: '' },
      decisionNote: { type: String, trim: true, default: '' },
    }],
    default: [],
  },
  ceoReviewedAt: { type: Date, default: null },
  ceoReviewedBy: { type: String, trim: true, default: '' },
  ceoNote: { type: String, trim: true, default: '' },
  societyShare: { type: Number, default: 0, min: 0 },
  externalShare: { type: Number, default: 0, min: 0 },
  externalLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalInvestorLedgerEntry',
    default: null,
  },
  societyLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankLedgerEntry',
    default: null,
  },
  createdBy: { type: String, trim: true, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ProjectExpenseSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  if (!this.yearMonth && this.expenseDate) {
    const d = new Date(this.expenseDate);
    this.yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  next();
});

module.exports = mongoose.model('ProjectExpense', ProjectExpenseSchema);
