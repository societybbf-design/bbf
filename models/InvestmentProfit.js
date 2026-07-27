const mongoose = require('mongoose');

const MemberShareSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  memberName: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  previousProfit: {
    type: Number,
    default: 0,
  },
  newProfit: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const InvestmentProfitSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  investmentCode: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  sector: {
    type: String,
    trim: true,
    default: '',
  },
  partner: {
    type: String,
    trim: true,
    default: '',
  },
  investmentAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  saleAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  profitAmount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  outcomeType: {
    type: String,
    enum: ['profit', 'loss'],
    default: 'profit',
    index: true,
  },
  distributionType: {
    type: String,
    enum: ['equal', 'proportional'],
    default: 'equal',
  },
  memberCount: {
    type: Number,
    default: 0,
  },
  shares: [MemberShareSchema],
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
  },
});

module.exports = mongoose.model('InvestmentProfit', InvestmentProfitSchema);
