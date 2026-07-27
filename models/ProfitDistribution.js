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

const ProfitDistributionSchema = new mongoose.Schema({
  totalAmount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  distributionType: {
    type: String,
    enum: ['equal', 'proportional', 'dividend_auto'],
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
  distributedBy: {
    type: String,
    trim: true,
    default: 'Admin',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('ProfitDistribution', ProfitDistributionSchema);
