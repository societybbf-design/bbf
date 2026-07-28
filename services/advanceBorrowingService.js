const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const InternalBorrowing = require('../models/InternalBorrowing');
const InvestmentContribution = require('../models/InvestmentContribution');
const Investment = require('../models/Investment');
const { creditInbound, tryCredit } = require('./bankLedgerService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Remaining amount still due on a contribution (supports partial / past payments). */
function contributionRemainingDue(contribution) {
  if (!contribution) return 0;
  if (contribution.unpaidAmount != null && contribution.unpaidAmount !== '') {
    return money(contribution.unpaidAmount);
  }
  const expected = money(contribution.expectedAmount);
  const covered = money(
    Number(contribution.paidFromSavings || 0)
    + Number(contribution.paidFromAdvance || 0)
    + Number(contribution.borrowedAmount || 0)
  );
  return money(Math.max(0, expected - covered));
}

function contributionIsBorrowable(contribution) {
  if (!contribution) return false;
  if (contribution.status === 'settled' && contributionRemainingDue(contribution) <= 0.001) {
    return false;
  }
  return contributionRemainingDue(contribution) > 0.001;
}

async function getActiveMembers() {
  return User.find({ role: 'member', status: 'active' }).sort({ name: 1 });
}

/**
 * Record an advance (surplus) deposit — credits advanceBalance + bank ledger.
 */
async function saveAdvanceDeposit(memberId, amount, options = {}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('Advance amount must be greater than zero.');
  }

  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) {
    throw httpError('Member not found.', 404);
  }

  const deposit = await Deposit.create({
    member: member._id,
    amount: normalized,
    type: 'advance',
    notes: options.notes || 'Advance / surplus deposit',
    recordedBy: options.recordedBy || '',
  });

  member.advanceBalance = money(Number(member.advanceBalance || 0) + normalized);
  await member.save();

  const { creditDeposit } = require('./bankLedgerService');
  const bankLedger = await creditDeposit({
    type: 'deposit',
    amount: normalized,
    referenceType: 'Deposit',
    referenceId: deposit._id,
    note: `Advance deposit: ${member.name}`,
    createdBy: options.recordedBy || 'Cashier',
  });

  return {
    deposit,
    member,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? null,
  };
}

/**
 * List open internal borrowings (optionally filtered).
 */
async function listInternalBorrowings({ status, memberId, openOnly = false } = {}) {
  const filter = {};
  if (openOnly) {
    filter.status = { $in: ['open', 'partial'] };
  } else if (status) {
    filter.status = status;
  }
  if (memberId) {
    filter.$or = [{ lender: memberId }, { borrower: memberId }];
  }

  return InternalBorrowing.find(filter)
    .populate('lender', 'name email advanceBalance')
    .populate('borrower', 'name email advanceBalance savings')
    .populate('investment', 'investmentCode amount')
    .sort({ createdAt: -1 });
}

/**
 * Cover an unpaid investment contribution by borrowing from another member's advance.
 */
async function createInternalBorrowing({
  investmentId,
  borrowerId,
  lenderId,
  amount,
  note = '',
  createdBy = 'Cashier',
  contributionId = null,
} = {}) {
  const normalized = money(amount);
  if (!(normalized > 0)) {
    throw httpError('Borrow amount must be greater than zero.');
  }
  if (String(borrowerId) === String(lenderId)) {
    throw httpError('Lender and borrower must be different members.');
  }

  const [lender, borrower, investment] = await Promise.all([
    User.findOne({ _id: lenderId, role: 'member', status: 'active' }),
    User.findOne({ _id: borrowerId, role: 'member', status: { $ne: 'deleted' } }),
    investmentId ? Investment.findById(investmentId) : null,
  ]);

  if (!lender) throw httpError('Lender member not found or inactive.', 404);
  if (!borrower) throw httpError('Borrower member not found.', 404);
  if (money(lender.advanceBalance) + 0.001 < normalized) {
    throw httpError(
      `Lender advance balance insufficient. Available: ${formatMoney(money(lender.advanceBalance), 2)}`
    );
  }

  let contribution = null;
  if (contributionId) {
    contribution = await InvestmentContribution.findById(contributionId);
    if (!contribution) {
      throw httpError('Contribution not found.', 404);
    }
    if (String(contribution.member) !== String(borrowerId)) {
      throw httpError('Contribution does not belong to the selected borrower.');
    }
    if (investmentId && String(contribution.investment) !== String(investmentId)) {
      throw httpError('Contribution does not match the selected investment.');
    }
  } else if (investmentId) {
    contribution = await InvestmentContribution.findOne({
      investment: investmentId,
      member: borrowerId,
    });
    if (!contribution) {
      throw httpError('No contribution record found for this borrower on the investment.');
    }
  }

  if (contribution) {
    if (!contributionIsBorrowable(contribution)) {
      throw httpError('This contribution has no remaining unpaid balance to cover.');
    }
    const stillDue = contributionRemainingDue(contribution);
    if (normalized > stillDue + 0.001) {
      throw httpError(`Borrow amount exceeds unpaid due of ${formatMoney(stillDue, 2)}.`);
    }
  }

  lender.advanceBalance = money(Number(lender.advanceBalance || 0) - normalized);
  await lender.save();

  const borrowing = await InternalBorrowing.create({
    investment: contribution?.investment || investmentId || null,
    contribution: contribution?._id || null,
    lender: lender._id,
    lenderName: lender.name,
    borrower: borrower._id,
    borrowerName: borrower.name,
    amount: normalized,
    amountSettled: 0,
    status: 'open',
    note: note?.trim() || `Internal advance cover for ${borrower.name}`,
    createdBy,
  });

  if (contribution) {
    const priorDue = contributionRemainingDue(contribution);
    contribution.borrowedAmount = money(Number(contribution.borrowedAmount || 0) + normalized);
    contribution.unpaidAmount = money(Math.max(0, priorDue - normalized));
    // Keep borrowable while unpaid remains, even after prior partial payments / borrows.
    contribution.status = contribution.unpaidAmount > 0.001 ? 'unpaid' : 'covered_by_borrow';
    contribution.borrowing = borrowing._id;
    await contribution.save();
  }

  return {
    borrowing,
    lender: { id: lender._id, name: lender.name, advanceBalance: lender.advanceBalance },
    borrower: { id: borrower._id, name: borrower.name },
    contribution,
  };
}

/**
 * Record repayment from a borrowing member.
 * Credits bank ledger and restores lender advanceBalance; settles the debt.
 */
async function settleInternalBorrowing(borrowingId, {
  amount = null,
  recordedBy = 'Cashier',
  notes = '',
} = {}) {
  const borrowing = await InternalBorrowing.findById(borrowingId);
  if (!borrowing) {
    throw httpError('Internal borrowing not found.', 404);
  }
  if (borrowing.status === 'settled' || borrowing.status === 'cancelled') {
    throw httpError('This borrowing is already closed.');
  }

  const outstanding = money(Number(borrowing.amount || 0) - Number(borrowing.amountSettled || 0));
  const payAmount = amount === null || amount === undefined || amount === ''
    ? outstanding
    : money(amount);

  if (!(payAmount > 0)) {
    throw httpError('Repayment amount must be greater than zero.');
  }
  if (payAmount > outstanding + 0.001) {
    throw httpError(`Repayment exceeds outstanding ${formatMoney(outstanding, 2)}.`);
  }

  const [lender, borrower] = await Promise.all([
    User.findById(borrowing.lender),
    User.findById(borrowing.borrower),
  ]);
  if (!lender || !borrower) {
    throw httpError('Lender or borrower account missing.', 404);
  }

  const deposit = await Deposit.create({
    member: borrower._id,
    amount: payAmount,
    type: 'borrow_repayment',
    notes: notes?.trim()
      || `Repayment of internal borrow to ${lender.name} (borrowing ${borrowing._id})`,
    recordedBy,
  });

  // Cash-in: society bank ledger increases (allow without opening so settlement is not skipped)
  let bankLedger = null;
  try {
    bankLedger = await creditInbound({
      type: 'deposit',
      amount: payAmount,
      referenceType: 'InternalBorrowing',
      referenceId: borrowing._id,
      note: `Borrow repayment from ${borrower.name} → refund advance to ${lender.name}`,
      createdBy: recordedBy,
    });
  } catch (error) {
    // Fall back to soft credit so lender refund still proceeds if ledger is mid-setup.
    bankLedger = await tryCredit({
      type: 'deposit',
      amount: payAmount,
      referenceType: 'InternalBorrowing',
      referenceId: borrowing._id,
      note: `Borrow repayment from ${borrower.name} → refund advance to ${lender.name}`,
      createdBy: recordedBy,
    });
    if (!bankLedger) {
      console.warn('[advanceBorrowing] bank ledger credit skipped during settle:', error.message);
    }
  }

  // Refund / restore original lender advance balance
  const lenderAdvanceBefore = money(lender.advanceBalance);
  lender.advanceBalance = money(Number(lender.advanceBalance || 0) + payAmount);
  await lender.save();

  borrowing.amountSettled = money(Number(borrowing.amountSettled || 0) + payAmount);
  borrowing.repaymentDeposit = deposit._id;
  const remaining = money(Number(borrowing.amount || 0) - Number(borrowing.amountSettled || 0));
  if (remaining <= 0.001) {
    borrowing.status = 'settled';
    borrowing.settledAt = new Date();
  } else {
    borrowing.status = 'partial';
  }
  await borrowing.save();

  if (borrowing.contribution) {
    const contribution = await InvestmentContribution.findById(borrowing.contribution);
    if (contribution && borrowing.status === 'settled') {
      const openOthers = await InternalBorrowing.countDocuments({
        contribution: contribution._id,
        status: { $in: ['open', 'partial'] },
        _id: { $ne: borrowing._id },
      });
      const stillUnpaid = contributionRemainingDue(contribution) > 0.001;
      if (!openOthers && !stillUnpaid) {
        contribution.status = 'settled';
        contribution.unpaidAmount = 0;
      } else if (stillUnpaid) {
        contribution.status = 'unpaid';
      } else {
        contribution.status = 'covered_by_borrow';
      }
      await contribution.save();
    }
  }

  // Also clear any remaining unpaid contribution for this borrower on same investment if fully covered
  if (borrowing.investment && borrowing.status === 'settled') {
    await InvestmentContribution.updateMany(
      {
        investment: borrowing.investment,
        member: borrower._id,
        status: { $in: ['unpaid', 'covered_by_borrow'] },
        unpaidAmount: { $lte: 0.001 },
      },
      { $set: { status: 'settled', unpaidAmount: 0 } }
    );
  }

  return {
    borrowing,
    deposit,
    bankLedger,
    lender: {
      id: lender._id,
      name: lender.name,
      advanceBalance: lender.advanceBalance,
      advanceBalanceBefore: lenderAdvanceBefore,
      refundedAmount: payAmount,
    },
    borrower: { id: borrower._id, name: borrower.name },
    settledAmount: payAmount,
    outstandingAfter: Math.max(0, remaining),
    fullySettled: borrowing.status === 'settled',
  };
}

/**
 * Pay an unpaid contribution without an existing borrow (direct dues repayment).
 * Credits bank ledger; marks contribution settled. Does not change savings unless requested.
 */
async function repayUnpaidContribution(contributionId, {
  amount = null,
  recordedBy = 'Cashier',
  notes = '',
} = {}) {
  const contribution = await InvestmentContribution.findById(contributionId)
    .populate('member', 'name email');
  if (!contribution) {
    throw httpError('Contribution not found.', 404);
  }
  const remainingDue = contributionRemainingDue(contribution);
  if (!contributionIsBorrowable(contribution) && !(remainingDue > 0)) {
    throw httpError('Contribution has no unpaid balance.');
  }

  // If covered by borrow with no remaining unpaid share, repay via borrowing settlement instead
  if (contribution.borrowing && contribution.status === 'covered_by_borrow' && remainingDue <= 0.001) {
    return settleInternalBorrowing(contribution.borrowing, { amount, recordedBy, notes });
  }

  const due = remainingDue;
  const payAmount = amount === null || amount === undefined || amount === ''
    ? due
    : money(amount);
  if (!(payAmount > 0)) {
    throw httpError('Repayment amount must be greater than zero.');
  }
  if (payAmount > due + 0.001) {
    throw httpError(`Repayment exceeds unpaid due of ${formatMoney(due, 2)}.`);
  }

  const member = await User.findById(contribution.member._id || contribution.member);
  const deposit = await Deposit.create({
    member: member._id,
    amount: payAmount,
    type: 'regular',
    notes: notes?.trim() || `Unpaid contribution repayment for investment ${contribution.investment}`,
    recordedBy,
  });

  // Paying dues: credit savings (they are catching up) + bank ledger
  member.savings = money(Number(member.savings || 0) + payAmount);
  await member.save();

  const bankLedger = await tryCredit({
    type: 'deposit',
    amount: payAmount,
    referenceType: 'InvestmentContribution',
    referenceId: contribution._id,
    note: `Unpaid contribution repayment: ${member.name}`,
    createdBy: recordedBy,
  });

  contribution.unpaidAmount = money(Math.max(0, due - payAmount));
  contribution.paidFromSavings = money(Number(contribution.paidFromSavings || 0) + payAmount);
  contribution.status = contribution.unpaidAmount > 0.001 ? 'unpaid' : 'settled';
  await contribution.save();

  return {
    contribution,
    deposit,
    bankLedger,
    member,
  };
}

async function listUnpaidContributions({ investmentId } = {}) {
  // Include any share with remaining unpaid amount (partial / past payments allowed),
  // plus covered-by-borrow rows that still need settlement tracking.
  const filter = {
    $or: [
      { unpaidAmount: { $gt: 0 } },
      { status: 'covered_by_borrow', borrowedAmount: { $gt: 0 } },
      {
        status: 'unpaid',
        $expr: {
          $gt: [
            {
              $subtract: [
                '$expectedAmount',
                {
                  $add: [
                    { $ifNull: ['$paidFromSavings', 0] },
                    { $ifNull: ['$paidFromAdvance', 0] },
                    { $ifNull: ['$borrowedAmount', 0] },
                  ],
                },
              ],
            },
            0,
          ],
        },
      },
    ],
  };
  if (investmentId) filter.investment = investmentId;

  return InvestmentContribution.find(filter)
    .populate('member', 'name email savings advanceBalance')
    .populate('investment', 'investmentCode amount status')
    .populate('borrowing')
    .sort({ createdAt: -1 });
}

async function listMemberAdvanceBalances() {
  const members = await getActiveMembers();
  return members.map((m) => ({
    id: m._id,
    name: m.name,
    email: m.email,
    savings: money(m.savings),
    advanceBalance: money(m.advanceBalance),
    profit: money(m.profit),
  }));
}

module.exports = {
  money,
  contributionRemainingDue,
  contributionIsBorrowable,
  saveAdvanceDeposit,
  listInternalBorrowings,
  createInternalBorrowing,
  settleInternalBorrowing,
  repayUnpaidContribution,
  listUnpaidContributions,
  listMemberAdvanceBalances,
  getActiveMembers,
};
