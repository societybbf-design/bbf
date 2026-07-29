'use strict';

const mongoose = require('mongoose');

/**
 * Per-user Cashier workspace notes + daily task checklist.
 * Survives page refresh; scoped to the logged-in staff user.
 */
const TaskSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  text: {
    type: String,
    trim: true,
    default: '',
  },
  done: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, { _id: false });

const CashierNotesPadSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  notes: {
    type: String,
    default: '',
  },
  tasks: {
    type: [TaskSchema],
    default: [],
  },
  /** Calendar day (YYYY-MM-DD) the checklist is currently for. */
  checklistDay: {
    type: String,
    trim: true,
    default: '',
  },
  /** Floating button placement (percent of viewport). */
  fabPosition: {
    leftPct: { type: Number, default: null },
    topPct: { type: Number, default: null },
    side: { type: String, enum: ['left', 'right', ''], default: 'right' },
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

CashierNotesPadSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('CashierNotesPad', CashierNotesPadSchema);
