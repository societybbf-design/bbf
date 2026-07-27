const InvestmentIou = require('../models/InvestmentIou');

async function generateIouCode() {
  const year = new Date().getFullYear();
  const prefix = `IOU-${year}-`;
  const latest = await InvestmentIou.findOne({
    iouCode: { $regex: `^${prefix}` },
  }).sort({ iouCode: -1 });

  let sequence = 1;
  if (latest?.iouCode) {
    const parts = latest.iouCode.split('-');
    sequence = Number(parts[2] || 0) + 1;
  }

  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

async function getAllIous() {
  return InvestmentIou.find().sort({ createdAt: -1 });
}

async function createInvestmentIou({
  investorName,
  dateOfBirth,
  location,
  amount,
  notes = '',
  createdBy = 'Admin',
}) {
  const normalizedName = investorName?.trim();
  const normalizedLocation = location?.trim();

  if (!normalizedName) {
    const error = new Error('Investor name is required.');
    error.status = 400;
    throw error;
  }

  if (!normalizedLocation) {
    const error = new Error('Investor location is required.');
    error.status = 400;
    throw error;
  }

  const normalizedAmount = Number(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    const error = new Error('IOU amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  const iouCode = await generateIouCode();

  const iou = await InvestmentIou.create({
    iouCode,
    investorName: normalizedName,
    dateOfBirth: parsedDateOfBirth && !Number.isNaN(parsedDateOfBirth.getTime()) ? parsedDateOfBirth : null,
    location: normalizedLocation,
    amount: normalizedAmount,
    notes: notes?.trim() || '',
    createdBy: createdBy?.trim() || 'Admin',
    status: 'pending',
  });

  return iou;
}

async function getIouById(iouId) {
  const iou = await InvestmentIou.findById(iouId);
  if (!iou) {
    const error = new Error('Investment IOU not found.');
    error.status = 404;
    throw error;
  }
  return iou;
}

async function deleteInvestmentIou(iouId) {
  const iou = await getIouById(iouId);
  await iou.deleteOne();
  return iou;
}

module.exports = {
  createInvestmentIou,
  deleteInvestmentIou,
  generateIouCode,
  getAllIous,
  getIouById,
};
