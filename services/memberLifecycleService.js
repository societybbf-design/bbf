const User = require('../models/User');
const Deposit = require('../models/Deposit');
const LoanApplication = require('../models/LoanApplication');

const ACTIVE_MEMBER_QUERY = { role: 'member', status: { $ne: 'deleted' } };
const DELETED_MEMBER_QUERY = { role: 'member', status: 'deleted' };

async function listActiveMembers() {
  return User.find(ACTIVE_MEMBER_QUERY).select('-password').sort({ name: 1 }).lean();
}

async function listDeletedMembers() {
  return User.find(DELETED_MEMBER_QUERY).select('-password').sort({ deletedAt: -1 }).lean();
}

async function getDeletedMemberCount() {
  return User.countDocuments(DELETED_MEMBER_QUERY);
}

async function removeMember(memberId, { reason = '', deletedBy = 'Admin' } = {}) {
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) {
    const error = new Error('Member not found or already removed.');
    error.status = 404;
    throw error;
  }

  member.status = 'deleted';
  member.deletedAt = new Date();
  member.deletedReason = String(reason || '').trim();
  member.deletedBy = String(deletedBy || 'Admin').trim();
  member.restoredAt = null;
  await member.save();
  return member.toJSON();
}

async function restoreMember(memberId) {
  const member = await User.findOne({ _id: memberId, role: 'member', status: 'deleted' });
  if (!member) {
    const error = new Error('Deleted member not found.');
    error.status = 404;
    throw error;
  }

  member.status = 'active';
  member.restoredAt = new Date();
  member.deletedAt = null;
  member.deletedReason = '';
  member.deletedBy = '';
  await member.save();
  return member.toJSON();
}

async function getMemberDeletionSummary(memberId) {
  const [depositCount, loanCount, activeLoans] = await Promise.all([
    Deposit.countDocuments({ member: memberId }),
    LoanApplication.countDocuments({ member: memberId }),
    LoanApplication.countDocuments({
      member: memberId,
      status: { $in: ['pending', 'approved', 'disbursed'] },
    }),
  ]);

  return { depositCount, loanCount, activeLoans };
}

async function permanentDeleteMember() {
  const error = new Error(
    'Hard delete is disabled. Soft-deleted accounts remain in the database for review and restore via User Management.'
  );
  error.status = 403;
  throw error;
}

module.exports = {
  ACTIVE_MEMBER_QUERY,
  DELETED_MEMBER_QUERY,
  listActiveMembers,
  listDeletedMembers,
  getDeletedMemberCount,
  removeMember,
  restoreMember,
  permanentDeleteMember,
  getMemberDeletionSummary,
};
