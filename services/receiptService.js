const Deposit = require('../models/Deposit');
const Counter = require('../models/Counter');
const { bindSession, sessionOpt } = require('./mongoTransaction');

/**
 * Atomically allocate the next receipt sequence for the current month.
 * Falls back to legacy max+1 if the Counter collection is unavailable.
 */
async function generateReceiptNumber(prefix = 'DEP', { session = null } = {}) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterKey = `receipt:${prefix}:${yearMonth}`;

  try {
    const counter = await Counter.findOneAndUpdate(
      { key: counterKey },
      { $inc: { seq: 1 } },
      sessionOpt(session, { upsert: true, new: true, setDefaultsOnInsert: true })
    );
    const sequence = Number(counter?.seq) || 1;
    return `${prefix}-${yearMonth}-${String(sequence).padStart(5, '0')}`;
  } catch (_) {
    const pattern = new RegExp(`^${prefix}-${yearMonth}-`);
    const latest = await bindSession(
      Deposit.findOne({ receiptNumber: pattern }).sort({ receiptNumber: -1 }).select('receiptNumber'),
      session
    ).lean();

    let sequence = 1;
    if (latest?.receiptNumber) {
      const tail = Number(String(latest.receiptNumber).split('-').pop());
      if (Number.isFinite(tail)) sequence = tail + 1;
    }
    return `${prefix}-${yearMonth}-${String(sequence).padStart(5, '0')}`;
  }
}

module.exports = {
  generateReceiptNumber,
};
