const mongoose = require('mongoose');

const InvestmentIouSchema = new mongoose.Schema({
  iouCode: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
  },
  investorName: {
    type: String,
    trim: true,
    required: true,
  },
  dateOfBirth: {
    type: Date,
    default: null,
  },
  location: {
    type: String,
    trim: true,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'fulfilled', 'cancelled'],
    default: 'pending',
  },
  createdBy: {
    type: String,
    trim: true,
    default: 'Admin',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

InvestmentIouSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('InvestmentIou', InvestmentIouSchema);
