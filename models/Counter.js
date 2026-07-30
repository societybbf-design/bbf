'use strict';

const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  seq: {
    type: Number,
    default: 0,
    min: 0,
  },
});

module.exports = mongoose.model('Counter', CounterSchema);
