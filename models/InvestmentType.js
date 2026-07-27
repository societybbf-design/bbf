const mongoose = require('mongoose');

const InvestmentTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  key: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    lowercase: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('InvestmentType', InvestmentTypeSchema);
