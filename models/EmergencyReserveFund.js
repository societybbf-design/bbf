const mongoose = require('mongoose');

const FUND_KEY = 'society_emergency_reserve';

const EmergencyReserveEntrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'allocation',
      'loan_disbursement',
      'loan_cover',
      'project_cover',
      'adjustment',
      'replenishment',
      'replenish',
    ],
    required: true,
  },
  direction: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
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
  },
}, { _id: true });

const EmergencyReserveFundSchema = new mongoose.Schema({
  key: {
    type: String,
    default: FUND_KEY,
    unique: true,
    index: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  entries: {
    type: [EmergencyReserveEntrySchema],
    default: [],
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

EmergencyReserveFundSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

EmergencyReserveFundSchema.statics.FUND_KEY = FUND_KEY;

module.exports = mongoose.model('EmergencyReserveFund', EmergencyReserveFundSchema);
