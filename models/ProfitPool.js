const mongoose = require('mongoose');

const POOL_KEY = 'society_profit_pool';

const ProfitPoolEntrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['monthly_profit', 'distribution', 'adjustment'],
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
  source: {
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

const ProfitPoolSchema = new mongoose.Schema({
  key: {
    type: String,
    default: POOL_KEY,
    unique: true,
    index: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  entries: {
    type: [ProfitPoolEntrySchema],
    default: [],
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ProfitPoolSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

ProfitPoolSchema.statics.POOL_KEY = POOL_KEY;

module.exports = mongoose.model('ProfitPool', ProfitPoolSchema);
