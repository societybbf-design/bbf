const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const { removeMember } = require('./memberLifecycleService');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function amountsMatch(a, b) {
  return Math.abs(money(a) - money(b)) < 0.015;
}

async function listActiveSocietyMembers() {
  return User.find({
    role: 'member',
    status: 'active',
    pendingEntryBuyIn: { $ne: true },
  }).select('-password');
}

/**
 * Society fund valuation used for new-member buy-in / replacement entry.
 * join: equal share of (savings + profit + advance) ÷ active members
 * replacement: departing member's savings + profit + advance (seat settlement value)
 */
async function getEntryValuation({ replaceMemberId = null } = {}) {
  const activeMembers = await listActiveSocietyMembers();
  const totalSavings = money(activeMembers.reduce((sum, m) => sum + Number(m.savings || 0), 0));
  const totalProfit = money(activeMembers.reduce((sum, m) => sum + Number(m.profit || 0), 0));
  const totalAdvance = money(activeMembers.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0));
  const totalOpeningSavings = money(activeMembers.reduce((sum, m) => sum + Number(m.openingSavingsBalance || 0), 0));
  const totalOpeningProfit = money(activeMembers.reduce((sum, m) => sum + Number(m.openingProfitBalance || 0), 0));
  const totalFund = money(totalSavings + totalProfit + totalAdvance);
  const activeCount = activeMembers.length;

  let mode = 'join';
  let departing = null;
  let entryAmount = 0;

  if (replaceMemberId) {
    departing = await User.findOne({
      _id: replaceMemberId,
      role: 'member',
      status: { $in: ['active', 'inactive'] },
    }).select('-password');

    if (!departing) {
      const error = new Error('Departing member not found or already removed.');
      error.status = 404;
      throw error;
    }

    mode = 'replacement';
    entryAmount = money(
      Number(departing.savings || 0)
      + Number(departing.profit || 0)
      + Number(departing.advanceBalance || 0)
    );
  } else if (activeCount > 0) {
    entryAmount = money(totalFund / activeCount);
  }

  return {
    mode,
    activeCount,
    totalSavings,
    totalProfit,
    totalAdvance,
    totalFund,
    totalOpeningSavings,
    totalOpeningProfit,
    entryAmount,
    formula: mode === 'replacement'
      ? 'Departing member savings + profit + advance (exit settlement value)'
      : activeCount > 0
        ? 'Equal share = (total savings + profit + advance) ÷ active members'
        : 'First member — no buy-in required (entry ৳0.00)',
    departing: departing
      ? {
        id: departing._id,
        name: departing.name,
        email: departing.email,
        savings: money(departing.savings),
        profit: money(departing.profit),
        advanceBalance: money(departing.advanceBalance),
        openingSavingsBalance: money(departing.openingSavingsBalance),
        openingProfitBalance: money(departing.openingProfitBalance),
      }
      : null,
  };
}

async function setMemberOpeningBalances({
  memberId,
  openingSavings = 0,
  openingProfit = 0,
  notes = '',
  recordedBy = 'CEO',
}) {
  const savingsAmt = money(openingSavings);
  const profitAmt = money(openingProfit);

  if (savingsAmt < 0 || profitAmt < 0) {
    const error = new Error('Opening balances cannot be negative.');
    error.status = 400;
    throw error;
  }

  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  const previousOpeningSavings = money(member.openingSavingsBalance);
  const previousOpeningProfit = money(member.openingProfitBalance);
  const savingsDelta = money(savingsAmt - previousOpeningSavings);
  const profitDelta = money(profitAmt - previousOpeningProfit);

  member.openingSavingsBalance = savingsAmt;
  member.openingProfitBalance = profitAmt;
  member.openingBalanceSetAt = new Date();
  member.openingBalanceSetBy = String(recordedBy || 'CEO').trim();
  member.savings = money(Number(member.savings || 0) + savingsDelta);
  member.profit = money(Number(member.profit || 0) + profitDelta);
  await member.save();

  await Deposit.deleteMany({ member: member._id, type: 'opening_balance' });
  let openingDeposit = null;
  if (savingsAmt > 0) {
    openingDeposit = await Deposit.create({
      member: member._id,
      amount: savingsAmt,
      type: 'opening_balance',
      notes: notes?.trim() || 'Historical opening balance (pre-digital migration)',
      recordedBy: String(recordedBy || 'CEO').trim(),
      createdAt: member.openingBalanceSetAt,
    });
  }

  return {
    member: member.toJSON(),
    openingDeposit,
    applied: {
      openingSavings: savingsAmt,
      openingProfit: profitAmt,
      savingsDelta,
      profitDelta,
    },
  };
}

/**
 * Replace a departing member: incoming payment settles their exit balance,
 * then activates the UM-created successor — even when society bank cash was insufficient alone.
 */
async function replaceMember({
  departingMemberId,
  newMemberId,
  entryAmountPaid,
  notes = '',
  recordedBy = 'CEO',
}) {
  if (!departingMemberId || !newMemberId) {
    const error = new Error('Departing member and replacement member (created in User Management) are required.');
    error.status = 400;
    throw error;
  }
  if (String(departingMemberId) === String(newMemberId)) {
    const error = new Error('Replacement member must be different from the departing member.');
    error.status = 400;
    throw error;
  }

  const valuation = await getEntryValuation({ replaceMemberId: departingMemberId });
  const requiredEntry = money(valuation.entryAmount);
  const paid = money(entryAmountPaid);

  if (!amountsMatch(paid, requiredEntry)) {
    const error = new Error(
      `Replacement payment must be exactly ${formatMoney(requiredEntry, 2)} (exiting member settlement value). Received ${formatMoney(paid, 2)}.`
    );
    error.status = 400;
    throw error;
  }

  const successor = await User.findOne({
    _id: newMemberId,
    role: 'member',
    status: { $ne: 'deleted' },
  });
  if (!successor) {
    const error = new Error('Replacement member not found. Create the account in User Management first.');
    error.status = 404;
    throw error;
  }

  const departingBefore = valuation.departing;
  const departingDoc = await User.findById(departingMemberId);
  if (!departingDoc) {
    const error = new Error('Departing member not found.');
    error.status = 404;
    throw error;
  }

  // Cash-in from replacement first — funds the exit even if society bank cash was short
  let bankCredit = null;
  let bankDebit = null;
  const { tryCredit, tryDebit } = require('./bankLedgerService');

  const entryDeposit = await Deposit.create({
    member: successor._id,
    amount: paid,
    type: 'replacement_entry',
    notes: notes?.trim()
      || `Replacement entry settling exit of ${departingDoc.name} (${departingDoc.email})`,
    recordedBy: String(recordedBy || 'CEO').trim(),
  });

  if (paid > 0) {
    bankCredit = await tryCredit({
      type: 'deposit',
      amount: paid,
      referenceType: 'Deposit',
      referenceId: entryDeposit._id,
      note: `Replacement payment in: ${successor.name}`,
      createdBy: recordedBy,
    });
  }

  // Route settlement to exiting member (ledger payout after the credit above)
  let exitDeposit = null;
  if (requiredEntry > 0) {
    exitDeposit = await Deposit.create({
      member: departingDoc._id,
      amount: requiredEntry,
      type: 'exit_settlement',
      notes: `Exit settlement funded by replacement ${successor.name}`,
      recordedBy: String(recordedBy || 'CEO').trim(),
    });

    bankDebit = await tryDebit({
      type: 'project_payout',
      amount: requiredEntry,
      referenceType: 'Deposit',
      referenceId: exitDeposit._id,
      note: `Exit settlement payout to ${departingDoc.name}`,
      createdBy: recordedBy,
    });
  }

  // Close departing live balances, then soft-delete (history preserved)
  departingDoc.exitSettledAt = new Date();
  departingDoc.exitSettlementAmount = requiredEntry;
  departingDoc.exitSettledBy = String(recordedBy || '').trim();
  departingDoc.exitSettlementSource = 'replacement';
  departingDoc.savings = 0;
  departingDoc.profit = 0;
  departingDoc.advanceBalance = 0;
  await departingDoc.save();

  const removed = await removeMember(departingMemberId, {
    reason: notes?.trim() || `Replaced by member ${successor.name}; exit settled via incoming payment`,
    deletedBy: recordedBy,
  });

  successor.replacedMember = departingDoc._id;
  successor.joinedViaReplacement = true;
  successor.replacementEntryAmount = requiredEntry;
  successor.savings = money(Number(successor.savings || 0) + paid);
  successor.pendingEntryBuyIn = false;
  successor.requiredEntryAmount = requiredEntry;
  successor.entryBuyInPaidAt = new Date();
  successor.status = 'active';
  await successor.save();

  return {
    valuation,
    departingMember: {
      id: removed.id || removed._id,
      name: removed.name,
      email: removed.email,
      status: removed.status,
      settledAmount: requiredEntry,
      balancesBeforeExit: departingBefore,
    },
    newMember: successor.toJSON(),
    entryDeposit,
    exitDeposit,
    bankLedger: {
      credit: bankCredit,
      debit: bankDebit,
    },
    message: 'Exit settled from replacement payment. Departing member closed; successor activated with seat buy-in.',
  };
}

async function getMigrationOverview() {
  const members = await User.find({ role: 'member', status: { $ne: 'deleted' } })
    .select('name email savings profit advanceBalance openingSavingsBalance openingProfitBalance openingBalanceSetAt status')
    .sort({ name: 1 });

  const totals = members.reduce((acc, m) => {
    acc.savings += Number(m.savings || 0);
    acc.profit += Number(m.profit || 0);
    acc.advance += Number(m.advanceBalance || 0);
    acc.openingSavings += Number(m.openingSavingsBalance || 0);
    acc.openingProfit += Number(m.openingProfitBalance || 0);
    if (Number(m.openingSavingsBalance || 0) > 0 || Number(m.openingProfitBalance || 0) > 0) {
      acc.migratedCount += 1;
    }
    return acc;
  }, {
    savings: 0,
    profit: 0,
    advance: 0,
    openingSavings: 0,
    openingProfit: 0,
    migratedCount: 0,
  });

  const digitalDepositSum = await Deposit.aggregate([
    { $match: { type: { $in: ['regular', 'replacement_entry', 'member_buyin'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const openingDepositSum = await Deposit.aggregate([
    { $match: { type: 'opening_balance' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  return {
    members: members.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.email,
      status: m.status,
      savings: money(m.savings),
      profit: money(m.profit),
      advanceBalance: money(m.advanceBalance),
      openingSavingsBalance: money(m.openingSavingsBalance),
      openingProfitBalance: money(m.openingProfitBalance),
      openingBalanceSetAt: m.openingBalanceSetAt,
    })),
    totals: {
      totalSavings: money(totals.savings),
      totalProfit: money(totals.profit),
      totalAdvance: money(totals.advance),
      totalOpeningSavings: money(totals.openingSavings),
      totalOpeningProfit: money(totals.openingProfit),
      migratedMemberCount: totals.migratedCount,
      digitalDepositTotal: money(digitalDepositSum[0]?.total || 0),
      openingDepositTotal: money(openingDepositSum[0]?.total || 0),
    },
  };
}

/**
 * Exit a member with no replacement buyer: pay settlement from the society bank ledger
 * (society fund cash), zero live balances (share returns to the remaining pool), soft-delete.
 * Settlement = savings + profit + advance. Blocked if outstanding loans or insufficient bank cash.
 */
async function exitMemberViaSocietyFund({
  memberId,
  notes = '',
  recordedBy = 'CEO',
  confirmSettlementAmount = null,
}) {
  if (!memberId) {
    const error = new Error('Member is required for society-fund exit.');
    error.status = 400;
    throw error;
  }

  const valuation = await getEntryValuation({ replaceMemberId: memberId });
  const settlement = money(valuation.entryAmount);
  const departingBefore = valuation.departing;

  if (confirmSettlementAmount != null && confirmSettlementAmount !== ''
    && !amountsMatch(confirmSettlementAmount, settlement)) {
    const error = new Error(
      `Confirm the exact settlement of ${formatMoney(settlement, 2)}. Received ${formatMoney(confirmSettlementAmount, 2)}.`
    );
    error.status = 400;
    throw error;
  }

  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['active', 'inactive'] },
  });
  if (!member) {
    const error = new Error('Member not found or already removed.');
    error.status = 404;
    throw error;
  }

  if (member.pendingEntryBuyIn) {
    const error = new Error('This member still has a pending buy-in and cannot exit via society fund.');
    error.status = 400;
    throw error;
  }

  const LoanApplication = require('../models/LoanApplication');
  const blockingLoans = await LoanApplication.find({
    member: memberId,
    status: { $in: ['pending', 'approved', 'disbursed'] },
  }).select('status amount outstandingBalance repaymentStatus loanType');

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
    const error = new Error(
      'Cannot exit via society fund while the member has pending, approved, or outstanding loans. Clear loans first, or use replacement exit if applicable.'
    );
    error.status = 400;
    throw error;
  }

  const { debit, getLedger } = require('./bankLedgerService');
  let bookBalance = 0;
  try {
    const ledgerSummary = await getLedger({ entryLimit: 1 });
    bookBalance = money(ledgerSummary?.bookBalance);
  } catch (error) {
    // opening may not be set — debit() will throw a clearer error
  }
  if (settlement > 0 && bookBalance + 0.001 < settlement) {
    const error = new Error(
      `Society bank cash is insufficient for this exit. Settlement ${formatMoney(settlement, 2)}; book balance ${formatMoney(bookBalance, 2)}. Record a replacement buy-in (brings cash in first) or top up the bank ledger.`
    );
    error.status = 400;
    throw error;
  }

  let exitDeposit = null;
  let bankDebit = null;
  const exitNotes = notes?.trim()
    || `Exit settlement funded from society fund (no replacement buyer)`;
  const removalReason = notes?.trim()
    || `Exited without replacement; settlement ${formatMoney(settlement, 2)} paid from society fund`;

  if (settlement > 0) {
    exitDeposit = await Deposit.create({
      member: member._id,
      amount: settlement,
      type: 'exit_settlement',
      notes: exitNotes,
      recordedBy: String(recordedBy || 'CEO').trim(),
    });

    try {
      // Hard debit — must succeed so cash and membership stay consistent
      bankDebit = await debit({
        type: 'project_payout',
        amount: settlement,
        referenceType: 'Deposit',
        referenceId: exitDeposit._id,
        note: `Society-fund exit payout to ${member.name}`,
        createdBy: recordedBy,
      });
    } catch (err) {
      await Deposit.deleteOne({ _id: exitDeposit._id }).catch(() => {});
      throw err;
    }
  }

  try {
    member.exitSettledAt = new Date();
    member.exitSettlementAmount = settlement;
    member.exitSettledBy = String(recordedBy || '').trim();
    member.exitSettlementSource = 'society_fund';
    member.savings = 0;
    member.profit = 0;
    member.advanceBalance = 0;
    await member.save();

    const removed = await removeMember(memberId, {
      reason: removalReason,
      deletedBy: recordedBy,
    });

    return {
      valuation,
      departingMember: {
        id: removed.id || removed._id,
        name: removed.name,
        email: removed.email,
        status: removed.status,
        settledAmount: settlement,
        settlementSource: 'society_fund',
        balancesBeforeExit: departingBefore,
      },
      exitDeposit,
      bankLedger: {
        debit: bankDebit,
        bookBalanceAfter: bankDebit?.ledger?.bookBalance
          ?? money(bookBalance - settlement),
      },
      message: settlement > 0
        ? `Member exited. ${formatMoney(settlement, 2)} paid from society fund; share returned to the remaining pool.`
        : 'Member exited with zero settlement. Seat removed from the active pool.',
    };
  } catch (err) {
    // Best-effort reverse of the bank debit if membership updates fail after payout.
    if (settlement > 0 && bankDebit) {
      try {
        const { credit } = require('./bankLedgerService');
        await credit({
          type: 'deposit',
          amount: settlement,
          referenceType: 'Deposit',
          referenceId: exitDeposit?._id || null,
          note: `Rollback society-fund exit for ${member.name}`,
          createdBy: recordedBy,
        });
      } catch (_) {
        // Preserve the original membership error for the API response.
      }
    }
    throw err;
  }
}

module.exports = {
  money,
  amountsMatch,
  listActiveSocietyMembers,
  getEntryValuation,
  setMemberOpeningBalances,
  replaceMember,
  exitMemberViaSocietyFund,
  getMigrationOverview,
};
