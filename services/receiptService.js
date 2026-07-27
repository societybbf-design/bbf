const Deposit = require('../models/Deposit');

async function generateReceiptNumber(prefix = 'DEP') {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
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

module.exports = {
  generateReceiptNumber,
};
