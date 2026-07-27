const mongoose = require('mongoose');

const SaleInvestmentLineSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null,
  },
  investmentCode: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    default: 0,
    min: 0,
  },
}, { _id: false });

const SaleSchema = new mongoose.Schema({
  saleCode: {
    type: String,
    trim: true,
    unique: true,
    index: true,
  },
  productName: {
    type: String,
    trim: true,
    default: '',
  },
  projectLabel: {
    type: String,
    trim: true,
    default: '',
  },
  primaryInvestment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null,
    index: true,
  },
  investmentCode: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    default: '',
  },
  location: {
    type: String,
    trim: true,
    default: '',
  },
  sector: {
    type: String,
    trim: true,
    default: '',
  },
  /** Manual inputs */
  saleAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  additionalCosts: {
    type: Number,
    default: 0,
    min: 0,
  },
  tax: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Auto-fetched from related project/property investments */
  totalInvestment: {
    type: Number,
    required: true,
    min: 0,
  },
  investmentLines: {
    type: [SaleInvestmentLineSchema],
    default: [],
  },
  /** saleAmount - totalInvestment - additionalCosts - tax */
  netProfitLoss: {
    type: Number,
    required: true,
  },
  outcomeType: {
    type: String,
    enum: ['profit', 'loss', 'break_even'],
    default: 'break_even',
    index: true,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  recordedBy: {
    type: String,
    trim: true,
    default: 'Admin',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('Sale', SaleSchema);
