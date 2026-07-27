const mongoose = require('mongoose');

const KycDocumentSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  documentType: {
    type: String,
    enum: ['nid', 'photo', 'address_proof', 'other'],
    default: 'other',
  },
  originalName: {
    type: String,
    trim: true,
    default: '',
  },
  filePath: {
    type: String,
    trim: true,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending',
  },
  adminNote: {
    type: String,
    trim: true,
    default: '',
  },
  verifiedBy: {
    type: String,
    trim: true,
    default: '',
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

KycDocumentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('KycDocument', KycDocumentSchema);
