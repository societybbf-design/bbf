'use strict';

const mongoose = require('mongoose');

/**
 * Investor-scoped capital wallet (not project-specific).
 * CEO cash deposits credit availableBalance. Project commitments
 * reserve then lock capital so it cannot be reused on other projects.
 * Remaining availableBalance stays free for later projects / extra expenses.
 */
const ExternalInvestorWalletSchema = new mongoose.Schema({
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    default: '',
  },
  /** Unallocated cash available for new project commitments or extra expenses */
  availableBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Soft-held for projects awaiting external approval / CEO fund release */
  reservedBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Permanently allocated to approved project stakes */
  lockedBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalDeposited: {
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

ExternalInvestorWalletSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ExternalInvestorWallet', ExternalInvestorWalletSchema);
