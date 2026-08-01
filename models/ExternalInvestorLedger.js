const mongoose = require('mongoose');

/**
 * Project-scoped sub-ledger for external investor capital, expense shares,
 * and profit distributions. Completely isolated from the Society Bank Ledger.
 */
const ExternalInvestorLedgerSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    unique: true,
    index: true,
  },
  investmentCode: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  bookBalance: {
    type: Number,
    default: 0,
  },
  capitalIn: {
    type: Number,
    default: 0,
    min: 0,
  },
  capitalOut: {
    type: Number,
    default: 0,
    min: 0,
  },
  profitAccrued: {
    type: Number,
    default: 0,
  },
  profitPaid: {
    type: Number,
    default: 0,
    min: 0,
  },
  expenseShare: {
    type: Number,
    default: 0,
    min: 0,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

ExternalInvestorLedgerSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ExternalInvestorLedger', ExternalInvestorLedgerSchema);
