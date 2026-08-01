const mongoose = require('mongoose');

const EXTERNAL_ENTRY_TYPES = Object.freeze([
  'external_capital_in',
  'external_capital_out',
  'external_profit_accrual',
  'external_profit_payout',
  'external_expense_share',
  'external_adjustment',
]);

/**
 * Line items for the project-specific external investor sub-ledger.
 * Never written to Society BankLedgerEntry / BankLedger.bookBalance.
 */
const ExternalInvestorLedgerEntrySchema = new mongoose.Schema({
  ledger: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalInvestorLedger',
    required: true,
    index: true,
  },
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    default: '',
  },
  type: {
    type: String,
    enum: EXTERNAL_ENTRY_TYPES,
    required: true,
    index: true,
  },
  direction: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  referenceType: {
    type: String,
    trim: true,
    default: '',
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
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
  /** CEO-approved external payouts sit here until marked paid off-books. */
  payoutStatus: {
    type: String,
    enum: ['', 'pending_ceo', 'approved', 'paid', 'rejected'],
    default: '',
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('ExternalInvestorLedgerEntry', ExternalInvestorLedgerEntrySchema);
module.exports.EXTERNAL_ENTRY_TYPES = EXTERNAL_ENTRY_TYPES;
