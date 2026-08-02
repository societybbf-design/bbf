'use strict';

const mongoose = require('mongoose');

/**
 * External investor payout / capital-return requests.
 * Created by CEO (or system after CEO settlement); executed only after
 * the designated External Investor explicitly approves.
 */
const ExternalPayoutRequestSchema = new mongoose.Schema({
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
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    default: '',
  },
  kind: {
    type: String,
    enum: ['profit', 'capital', 'settlement', 'expense'],
    default: 'settlement',
    index: true,
  },
  /** Capital return portion */
  capitalAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Profit / accrued portion after external-specific expense deduction */
  profitAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** External-specific extra expenses deducted before profit payout */
  externalExtraExpenses: {
    type: Number,
    default: 0,
    min: 0,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  status: {
    type: String,
    enum: ['pending_external_approval', 'approved', 'paid', 'rejected'],
    default: 'pending_external_approval',
    index: true,
  },
  source: {
    type: String,
    enum: ['liquidation', 'monthly_return', 'project_expense', 'manual'],
    default: 'manual',
    index: true,
  },
  executedAt: {
    type: Date,
    default: null,
  },
  executedBy: {
    type: String,
    trim: true,
    default: '',
  },
  referenceType: {
    type: String,
    trim: true,
    default: '',
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
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
  decidedAt: {
    type: Date,
    default: null,
  },
  decidedBy: {
    type: String,
    trim: true,
    default: '',
  },
  decisionNote: {
    type: String,
    trim: true,
    default: '',
  },
  ledgerEntryIds: {
    type: [mongoose.Schema.Types.ObjectId],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ExternalPayoutRequestSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ExternalPayoutRequest', ExternalPayoutRequestSchema);
