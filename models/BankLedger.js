const mongoose = require('mongoose');

const LEDGER_KEY = 'society_bank';

const BankLedgerSchema = new mongoose.Schema({
  key: {
    type: String,
    default: LEDGER_KEY,
    unique: true,
    index: true,
  },
  openingBalance: {
    type: Number,
    default: null,
    min: 0,
  },
  openingSetAt: {
    type: Date,
    default: null,
  },
  openingSetBy: {
    type: String,
    trim: true,
    default: '',
  },
  /** Running book balance after opening + all ledger entries */
  bookBalance: {
    type: Number,
    default: 0,
  },
  lastActualBalance: {
    type: Number,
    default: null,
  },
  lastReconciledAt: {
    type: Date,
    default: null,
  },
  lastReconciledBy: {
    type: String,
    trim: true,
    default: '',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

BankLedgerSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

BankLedgerSchema.statics.LEDGER_KEY = LEDGER_KEY;

module.exports = mongoose.model('BankLedger', BankLedgerSchema);
