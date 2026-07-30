const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const LoanApplication = require('../models/LoanApplication');
const InternalBorrowing = require('../models/InternalBorrowing');

const ACTIVE_MEMBER_QUERY = { role: 'member', status: { $ne: 'deleted' } };
const DELETED_MEMBER_QUERY = { role: 'member', status: 'deleted' };

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function amountsMatch(a, b) {
  return Math.abs(money(a) - money(b)) < 0.011;
}

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
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $nin: ['inactive', 'blocked'] },
  });
  if (!member) {
    const error = new Error('Member not found or already inactive.');
    error.status = 404;
    throw error;
  }

  member.status = 'inactive';
  member.sessionVersion = Number(member.sessionVersion || 0) + 1;
  member.deletedAt = new Date();
  member.deletedReason = String(reason || '').trim();
  member.deletedBy = String(deletedBy || 'Admin').trim();
  member.restoredAt = null;
  await member.save();
  return member.toJSON();
}

async function restoreMember(memberId) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['inactive', 'deleted'] },
  });
  if (!member) {
    const error = new Error('Inactive member not found.');
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

async function assertNoBlockingLoans(memberId) {
  const blockingLoans = await LoanApplication.find({
    member: memberId,
    status: { $in: ['pending', 'approved', 'disbursed'] },
  }).select('status amount outstandingBalance repaymentStatus');

  const unresolved = blockingLoans.filter((loan) => {
    if (loan.status === 'pending' || loan.status === 'approved') return true;
    if (loan.status === 'disbursed') {
      if (loan.repaymentStatus === 'paid_off') return false;
      const outstanding = loan.outstandingBalance != null
        ? Number(loan.outstandingBalance)
        : Number(loan.amount || 0);
      return outstanding > 0.009;
    }
    return false;
  });

  if (unresolved.length) {
    throw httpError(
      'Cannot delete this member while they have pending, approved, or outstanding loans. Clear loans first.'
    );
  }
}

async function assertNoOpenBorrowingsAsBorrower(memberId) {
  const open = await InternalBorrowing.countDocuments({
    borrower: memberId,
    status: { $in: ['open', 'partial'] },
  });
  if (open > 0) {
    throw httpError(
      'Cannot delete this member while they have open internal borrowings to repay. Settle borrowings at Cashier first.'
    );
  }
}

/**
 * Full financial standing for deletion / soft-delete settlement.
 * Payable = savings + profit + advance + emergency reserve share.
 * Book debit covers savings + profit + advance; reserve share is paid from the Emergency Reserve Fund.
 */
async function getMemberDeletionSettlementPreview(memberId) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $ne: 'deleted' },
  }).select('-password');

  if (!member) {
    throw httpError('Member not found or already removed.', 404);
  }

  const [depositAgg, depositCount, loanCount, activeLoans, openBorrowingsAsBorrower, openBorrowingsAsLender, reserve] = await Promise.all([
    Deposit.aggregate([
      { $match: { member: member._id } },
      {
        $group: {
          _id: null,
          lifetimeDeposits: { $sum: '$amount' },
          depositCount: { $sum: 1 },
        },
      },
    ]),
    Deposit.countDocuments({ member: member._id }),
    LoanApplication.countDocuments({ member: member._id }),
    LoanApplication.countDocuments({
      member: member._id,
      status: { $in: ['pending', 'approved', 'disbursed'] },
      repaymentStatus: { $ne: 'paid_off' },
    }),
    InternalBorrowing.countDocuments({
      borrower: member._id,
      status: { $in: ['open', 'partial'] },
    }),
    InternalBorrowing.countDocuments({
      lender: member._id,
      status: { $in: ['open', 'partial'] },
    }),
    require('./emergencyReserveService').getMemberReserveShare(member._id).catch(() => ({
      shareAmount: 0,
      fundBalance: 0,
    })),
  ]);

  const lifetimeDeposits = money(depositAgg[0]?.lifetimeDeposits || 0);
  const breakdown = {
    savings: money(member.savings),
    profit: money(member.profit),
    advance: money(member.advanceBalance),
    emergencyReserveShare: money(reserve.shareAmount || 0),
  };
  const bookPayable = money(breakdown.savings + breakdown.profit + breakdown.advance);
  const settlementAmount = money(bookPayable + breakdown.emergencyReserveShare);

  let bookBalance = null;
  let openingSet = false;
  try {
    const { getLedger } = require('./bankLedgerService');
    const ledger = await getLedger({ entryLimit: 1 });
    bookBalance = money(ledger.bookBalance);
    openingSet = Boolean(ledger.openingSet);
  } catch (_) {
    // leave null
  }

  const blockers = [];
  if (activeLoans > 0) {
    blockers.push('Outstanding or pending loans must be cleared first.');
  }
  if (openBorrowingsAsBorrower > 0) {
    blockers.push('Open internal borrowings (as borrower) must be settled at Cashier first.');
  }
  if (settlementAmount > 0 && openingSet && bookBalance != null && bookPayable > bookBalance + 0.001) {
    blockers.push(
      `Central book balance (${formatMoney(bookBalance, 2)}) is insufficient for the book payout of ${formatMoney(bookPayable, 2)}.`
    );
  }
  if (settlementAmount > 0 && !openingSet) {
    blockers.push('Bank ledger opening balance must be set before a deletion settlement can debit the central book.');
  }
  if (
    breakdown.emergencyReserveShare > 0
    && money(reserve.fundBalance || 0) + 0.001 < breakdown.emergencyReserveShare
  ) {
    blockers.push('Emergency / Reserve Fund has insufficient balance for this member’s reserve share.');
  }

  return {
    member: {
      id: member._id,
      name: member.name,
      email: member.email,
      status: member.status,
    },
    requiresSettlement: settlementAmount > 0.001,
    settlementAmount,
    bookPayable,
    settlementBreakdown: breakdown,
    lifetimeDeposits,
    depositCount: depositAgg[0]?.depositCount || depositCount,
    loanCount,
    activeLoans,
    openBorrowingsAsBorrower,
    openBorrowingsAsLender,
    bookBalance,
    openingSet,
    reserveFundBalance: money(reserve.fundBalance || 0),
    canDelete: blockers.length === 0,
    blockers,
    formula: 'Settlement = savings + profit + advance + emergency reserve share. '
      + 'Savings/profit/advance are debited from the Central Book Balance; reserve share is paid from the Emergency / Reserve Fund. '
      + 'Balances are zeroed and an exit_settlement trail is recorded before soft-delete.',
  };
}

/** @deprecated Prefer getMemberDeletionSettlementPreview */
async function getMemberDeletionSummary(memberId) {
  const preview = await getMemberDeletionSettlementPreview(memberId);
  return {
    depositCount: preview.depositCount,
    loanCount: preview.loanCount,
    activeLoans: preview.activeLoans,
    settlementAmount: preview.settlementAmount,
    settlementBreakdown: preview.settlementBreakdown,
    bookBalance: preview.bookBalance,
    canDelete: preview.canDelete,
    blockers: preview.blockers,
  };
}

/**
 * Pay out member balances (debit central book + reserve), zero balances, leave settlement trail.
 * Does not soft-delete — caller continues with status change.
 */
async function settleMemberBalancesForDeletion(memberId, {
  confirmedAmount = null,
  processedBy = 'User Management',
  reason = '',
} = {}) {
  const preview = await getMemberDeletionSettlementPreview(memberId);
  if (!preview.canDelete) {
    throw httpError(preview.blockers[0] || 'Member cannot be deleted until financial blockers are cleared.');
  }

  if (preview.requiresSettlement) {
    if (confirmedAmount == null || confirmedAmount === '') {
      throw httpError(
        `Confirm the exact settlement of ${formatMoney(preview.settlementAmount, 2)} before deleting this member.`,
        400
      );
    }
    if (!amountsMatch(confirmedAmount, preview.settlementAmount)) {
      throw httpError(
        `Settlement confirmation mismatch. Expected ${formatMoney(preview.settlementAmount, 2)}, received ${formatMoney(confirmedAmount, 2)}.`
      );
    }
  }

  await assertNoBlockingLoans(memberId);
  await assertNoOpenBorrowingsAsBorrower(memberId);

  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $ne: 'deleted' },
  });
  if (!member) {
    throw httpError('Member not found or already removed.', 404);
  }

  const settlement = money(preview.settlementAmount);
  const bookPayable = money(preview.bookPayable);
  const reserveShare = money(preview.settlementBreakdown.emergencyReserveShare);
  let exitDeposit = null;
  let bankDebit = null;
  let reserveDebit = null;

  if (bookPayable > 0) {
    exitDeposit = await Deposit.create({
      member: member._id,
      amount: bookPayable,
      type: 'exit_settlement',
      notes: reason?.trim()
        || `User Management deletion settlement for ${member.name} `
          + `(savings ${formatMoney(preview.settlementBreakdown.savings, 2)} `
          + `+ profit ${formatMoney(preview.settlementBreakdown.profit, 2)} `
          + `+ advance ${formatMoney(preview.settlementBreakdown.advance, 2)})`,
      recordedBy: String(processedBy || 'User Management').trim(),
    });

    try {
      const { debit } = require('./bankLedgerService');
      bankDebit = await debit({
        type: 'project_payout',
        amount: bookPayable,
        referenceType: 'Deposit',
        referenceId: exitDeposit._id,
        note: `Member deletion settlement payout to ${member.name} · Central Book Balance debit`,
        createdBy: processedBy,
      });
    } catch (err) {
      await Deposit.deleteOne({ _id: exitDeposit._id }).catch(() => {});
      throw err;
    }
  }

  if (reserveShare > 0) {
    try {
      const { debitReserve } = require('./emergencyReserveService');
      reserveDebit = await debitReserve(reserveShare, {
        type: 'release',
        note: `Member deletion — reserve share payout for ${member.name}`,
        createdBy: processedBy,
        referenceType: 'User',
        referenceId: member._id,
      });
    } catch (err) {
      if (bankDebit?.entry?._id || bankDebit?.ledger) {
        try {
          const { creditInbound } = require('./bankLedgerService');
          await creditInbound({
            type: 'adjustment',
            amount: bookPayable,
            referenceType: 'Deposit',
            referenceId: exitDeposit?._id,
            note: `Rollback deletion settlement after reserve payout failed · ${member.name}`,
            createdBy: processedBy,
          });
        } catch (_) {
          // best-effort
        }
      }
      if (exitDeposit?._id) {
        await Deposit.deleteOne({ _id: exitDeposit._id }).catch(() => {});
      }
      throw err;
    }
  }

  member.exitSettledAt = new Date();
  member.exitSettlementAmount = settlement;
  member.exitSettledBy = String(processedBy || 'User Management').trim();
  member.exitSettlementSource = 'user_management';
  member.savings = 0;
  member.profit = 0;
  member.advanceBalance = 0;
  await member.save();

  return {
    member,
    preview,
    settlementAmount: settlement,
    bookPayable,
    reserveShare,
    exitDeposit,
    bankDebit,
    reserveDebit,
    bookBalanceAfter: bankDebit?.ledger?.bookBalance ?? preview.bookBalance,
  };
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
  money,
  listActiveMembers,
  listDeletedMembers,
  getDeletedMemberCount,
  removeMember,
  restoreMember,
  permanentDeleteMember,
  getMemberDeletionSummary,
  getMemberDeletionSettlementPreview,
  settleMemberBalancesForDeletion,
};
