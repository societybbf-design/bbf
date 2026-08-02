'use strict';

const mongoose = require('mongoose');

const WALLET_ENTRY_TYPES = Object.freeze([
  'deposit',
  'reserve',
  'unreserve',
  'lock',
  'unlock',
  'expense',
  'adjustment',
]);

const ExternalInvestorWalletEntrySchema = new mongoose.Schema({
  wallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalInvestorWallet',
    required: true,
    index: true,
  },
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: WALLET_ENTRY_TYPES,
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  availableAfter: {
    type: Number,
    required: true,
  },
  reservedAfter: {
    type: Number,
    required: true,
  },
  lockedAfter: {
    type: Number,
    required: true,
  },
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null,
    index: true,
  },
  investmentCode: {
    type: String,
    trim: true,
    default: '',
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

module.exports = mongoose.model('ExternalInvestorWalletEntry', ExternalInvestorWalletEntrySchema);
module.exports.WALLET_ENTRY_TYPES = WALLET_ENTRY_TYPES;
