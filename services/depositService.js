const Deposit = require('../models/Deposit');

async function getAllDeposits() {
  return Deposit.find()
    .sort({ createdAt: -1 })
    .populate({ path: 'member', select: 'name email' })
    .lean();
}

module.exports = {
  getAllDeposits,
};
