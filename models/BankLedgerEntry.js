const mongoose = require('mongoose');

const ENTRY_TYPES = [
  'opening',
  'deposit',
  'project_payout',
  'project_sale',
  'monthly_profit',
  'profit_distribution',
  'adjustment',
];

const BankLedgerEntrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ENTRY_TYPES,
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
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

BankLedgerEntrySchema.statics.ENTRY_TYPES = ENTRY_TYPES;

module.exports = mongoose.model('BankLedgerEntry', BankLedgerEntrySchema);
