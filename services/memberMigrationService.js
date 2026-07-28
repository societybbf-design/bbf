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

/** First day of the calendar month after `fromDate` (profit eligibility start). */
function getNextMonthStart(fromDate = new Date()) {
  const d = new Date(fromDate);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

async function listActiveSocietyMembers() {
  return User.find({
    role: 'member',
    status: 'active',
    pendingEntryBuyIn: { $ne: true },
  }).select('-password');
}

async function getActiveProjectValuation() {
  const Investment = require('../models/Investment');
  const activeProjects = await Investment.find({
    status: 'active',
    ledgerLockedAt: null,
  })
    .select('investmentCode sector partner amount profit returnMode societyOwnershipPct societyAmount monthlyProfitTotal createdAt')
    .sort({ createdAt: -1 });

  const projects = activeProjects.map((project) => {
    const bookAmount = money(
      Number(project.societyAmount || 0) > 0
        ? project.societyAmount
        : (Number(project.amount || 0) * Number(project.societyOwnershipPct || 100)) / 100
    );

    return {
      investmentId: project._id,
      investmentCode: project.investmentCode || '',
      label: [project.sector, project.partner].filter(Boolean).join(' · ') || project.investmentCode || 'Project',
      returnMode: project.returnMode || 'fixed_term',
      bookAmount,
      societyOwnershipPct: Number(project.societyOwnershipPct || 100),
      monthlyProfitTotal: money(project.monthlyProfitTotal),
      profitToDate: money(project.profit),
      isRunningMonthly: project.returnMode === 'monthly',
    };
  });

  return {
    projects,
    totalProjectValuation: money(projects.reduce((sum, p) => sum + Number(p.bookAmount || 0), 0)),
    runningMonthlyCount: projects.filter((p) => p.isRunningMonthly).length,
  };
}

/**
 * Society fund valuation used for member replacement / exit settlement.
 * replacement: departing member's savings + profit + advance (seat settlement value)
 */
async function getEntryValuation({ replaceMemberId = null } = {}) {
  const activeMembers = await listActiveSocietyMembers();
  const totalSavings = money(activeMembers.reduce((sum, m) => sum + Number(m.savings || 0), 0));
  const totalProfit = money(activeMembers.reduce((sum, m) => sum + Number(m.profit || 0), 0));
  const totalAdvance = money(activeMembers.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0));
  const totalMemberBalances = money(totalSavings + totalProfit + totalAdvance);
  const activeCount = activeMembers.length;

  const { projects, totalProjectValuation, runningMonthlyCount } = await getActiveProjectValuation();
  const totalFund = money(totalMemberBalances + totalProjectValuation);

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
    totalMemberBalances,
    totalFund,
    totalProjectValuation,
    activeProjects: projects,
    runningMonthlyCount,
    entryAmount,
    formula: mode === 'replacement'
      ? 'Departing member savings + profit + advance (exit settlement value)'
      : activeCount > 0
        ? 'Equal share = (member savings + profit + advance + active project valuations) ÷ active members'
        : 'No active members — entry ৳0.00',
    profitNote: runningMonthlyCount > 0
      ? `Running-project profits are split by each member's savings+profit balance ratio (${runningMonthlyCount} monthly project(s) active).`
      : 'Society profit distributions use each member\'s savings+profit balance ratio.',
    departing: departing
      ? {
        id: departing._id,
        name: departing.name,
        email: departing.email,
        savings: money(departing.savings),
        profit: money(departing.profit),
        advanceBalance: money(departing.advanceBalance),
      }
      : null,
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
  successor.profitEligibleFrom = getNextMonthStart(successor.entryBuyInPaidAt);
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
  getNextMonthStart,
  listActiveSocietyMembers,
  getEntryValuation,
  replaceMember,
  exitMemberViaSocietyFund,
};
