'use strict';

const Deposit = require('../models/Deposit');
const Counter = require('../models/Counter');
const { bindSession, sessionOpt } = require('./mongoTransaction');

function receiptYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatReceiptNumber(prefix, yearMonth, sequence) {
  return `${prefix}-${yearMonth}-${String(sequence).padStart(5, '0')}`;
}

function parseReceiptSequence(receiptNumber, prefix, yearMonth) {
  const match = new RegExp(`^${prefix}-${yearMonth}-(\\d+)$`).exec(String(receiptNumber || ''));
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Highest existing receipt sequence for prefix + YYYYMM (0 when none).
 * Sorted lexicographically works while sequences stay zero-padded to 5 digits.
 */
async function getLatestReceiptSequence(prefix, yearMonth, session = null) {
  const pattern = new RegExp(`^${prefix}-${yearMonth}-\\d+$`);
  const latest = await bindSession(
    Deposit.findOne({ receiptNumber: pattern }).sort({ receiptNumber: -1 }).select('receiptNumber'),
    session
  ).lean();
  return parseReceiptSequence(latest?.receiptNumber, prefix, yearMonth);
}

function isDuplicateKeyError(error) {
  return Boolean(
    error
    && (error.code === 11000
      || error.code === 11001
      || /E11000|duplicate key/i.test(String(error.message || '')))
  );
}

function isReceiptDuplicateError(error) {
  if (!isDuplicateKeyError(error)) return false;
  const haystack = [
    error.message,
    error.errmsg,
    JSON.stringify(error.keyPattern || {}),
    JSON.stringify(error.keyValue || {}),
  ].join(' ');
  return /receiptNumber/i.test(haystack);
}

/**
 * Atomically allocate the next receipt number for the current calendar month.
 * Pattern: DEP-202607-00002
 *
 * Uses Counter.findOneAndUpdate($inc) so concurrent cashiers cannot share an ID.
 * Before incrementing, raises the counter to at least the max existing deposit
 * receipt for that month (fixes legacy / reset counters that would collide on 00001).
 */
async function generateReceiptNumber(prefix = 'DEP', { session = null, at = new Date() } = {}) {
  const yearMonth = receiptYearMonth(at);
  const counterKey = `receipt:${prefix}:${yearMonth}`;
  const floor = await getLatestReceiptSequence(prefix, yearMonth, session);

  // Ensure the counter document exists, seeded to the current max receipt sequence.
  await Counter.findOneAndUpdate(
    { key: counterKey },
    { $setOnInsert: { key: counterKey, seq: floor } },
    sessionOpt(session, { upsert: true, new: true, setDefaultsOnInsert: true })
  );

  // Never allow the counter to lag behind receipts already stored in deposits.
  // Conditional $lt avoids rewinding a counter another request already advanced.
  await Counter.findOneAndUpdate(
    { key: counterKey, seq: { $lt: floor } },
    { $set: { seq: floor } },
    sessionOpt(session, { new: true })
  );

  const counter = await Counter.findOneAndUpdate(
    { key: counterKey },
    { $inc: { seq: 1 } },
    sessionOpt(session, { new: true })
  );

  const sequence = Number(counter?.seq);
  if (!Number.isFinite(sequence) || sequence < 1) {
    const error = new Error('Unable to allocate a deposit receipt number. Please try again.');
    error.status = 500;
    throw error;
  }

  return formatReceiptNumber(prefix, yearMonth, sequence);
}

/**
 * Create a Deposit with a freshly allocated receipt number.
 * Retries on receiptNumber unique-index collisions (E11000).
 */
async function createDepositWithReceipt(DepositModel, fields, session = null, {
  maxAttempts = 6,
} = {}) {
  const { createWithSession } = require('./mongoTransaction');
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receiptNumber = await generateReceiptNumber('DEP', { session });
    try {
      return await createWithSession(DepositModel, {
        ...fields,
        receiptNumber,
      }, session);
    } catch (error) {
      lastError = error;
      if (!isReceiptDuplicateError(error)) throw error;
      // Counter was behind or raced; loop reseeds from max and increments again.
    }
  }

  const error = new Error(
    lastError?.message
      || 'Could not assign a unique deposit receipt number. Please try again.'
  );
  error.status = 409;
  error.cause = lastError;
  throw error;
}

module.exports = {
  generateReceiptNumber,
  createDepositWithReceipt,
  getLatestReceiptSequence,
  parseReceiptSequence,
  formatReceiptNumber,
  receiptYearMonth,
  isDuplicateKeyError,
  isReceiptDuplicateError,
};
