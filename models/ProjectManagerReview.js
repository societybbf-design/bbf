'use strict';

const mongoose = require('mongoose');

/**
 * Performance review submitted by an External Investor about their
 * assigned Project Manager for a specific project.
 */
const ProjectManagerReviewSchema = new mongoose.Schema({
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
  },
  projectManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  projectManagerName: {
    type: String,
    trim: true,
    default: '',
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  reviewerName: {
    type: String,
    trim: true,
    default: '',
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  feedback: {
    type: String,
    trim: true,
    default: '',
    maxlength: 2000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('ProjectManagerReview', ProjectManagerReviewSchema);
