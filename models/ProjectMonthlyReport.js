const mongoose = require('mongoose');

/**
 * Monthly closing / P&L statement submitted by the Project Manager (maker).
 * Net Profit = Gross Revenue − total recorded expenses for the period.
 * CEO reviews; external profit portion routes through the external sub-ledger
 * (never the Society Bank Ledger).
 */
const ProjectMonthlyReportSchema = new mongoose.Schema({
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
  yearMonth: {
    type: String,
    trim: true,
    required: true,
    index: true,
  },
  grossRevenue: {
    type: Number,
    required: true,
    min: 0,
  },
  totalExpenses: {
    type: Number,
    default: 0,
    min: 0,
  },
  netProfit: {
    type: Number,
    default: 0,
  },
  societyOwnershipPct: { type: Number, default: 100 },
  investorOwnershipPct: { type: Number, default: 0 },
  societyProfitShare: { type: Number, default: 0 },
  investorProfitShare: { type: Number, default: 0 },
  expenseIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectExpense',
  }],
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: [
      'draft',
      'pending_ceo',
      'ceo_approved',
      'ceo_rejected',
      'external_payout_queued',
      'executed',
    ],
    default: 'draft',
    index: true,
  },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: String, trim: true, default: '' },
  ceoReviewedAt: { type: Date, default: null },
  ceoReviewedBy: { type: String, trim: true, default: '' },
  ceoNote: { type: String, trim: true, default: '' },
  /** External sub-ledger accrual / payout tracking (not society bank). */
  externalLedgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalInvestorLedgerEntry',
    default: null,
  },
  externalPayoutEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalInvestorLedgerEntry',
    default: null,
  },
  societyExecutedAt: { type: Date, default: null },
  createdBy: { type: String, trim: true, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ProjectMonthlyReportSchema.index({ investment: 1, yearMonth: 1 }, { unique: true });

ProjectMonthlyReportSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ProjectMonthlyReport', ProjectMonthlyReportSchema);
