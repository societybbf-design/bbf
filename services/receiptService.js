const Deposit = require('../models/Deposit');
const Counter = require('../models/Counter');

/**
 * Atomically allocate the next receipt sequence for the current month.
 * Falls back to legacy max+1 if the Counter collection is unavailable.
 */
async function generateReceiptNumber(prefix = 'DEP') {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterKey = `receipt:${prefix}:${yearMonth}`;

  try {
    const counter = await Counter.findOneAndUpdate(
      { key: counterKey },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const sequence = Number(counter?.seq) || 1;
    return `${prefix}-${yearMonth}-${String(sequence).padStart(5, '0')}`;
  } catch (_) {
    const pattern = new RegExp(`^${prefix}-${yearMonth}-`);
    const latest = await Deposit.findOne({ receiptNumber: pattern })
      .sort({ receiptNumber: -1 })
      .select('receiptNumber')
      .lean();

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
