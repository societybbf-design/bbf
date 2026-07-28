const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const { removeMember } = require('./memberLifecycleService');
const { normalizePaymentChannel } = require('./paymentChannelService');

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

function yearMonthRangeForPastYear(referenceDate = new Date()) {
  const end = new Date(referenceDate);
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const startYm = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const endYm = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  return { start, end, startYm, endYm };
}

async function listActiveSocietyMembers() {
  return User.find({
    role: 'member',
    status: 'active',
    pendingEntryBuyIn: { $ne: true },
  }).select('-password');
}

/**
 * Auto-fetch society past-year deposits and active (running) projects for UM baseline.
 */
async function getSocietyBaselineData({ manualProjectValuations = [] } = {}) {
  const Investment = require('../models/Investment');
  const { start, end, startYm, endYm } = yearMonthRangeForPastYear();

  const pastYearMatch = {
    type: { $in: ['regular', 'opening_balance', 'member_buyin', 'replacement_entry', 'advance'] },
    createdAt: { $gte: start, $lte: end },
  };

  const [pastYearAgg, activeProjects] = await Promise.all([
    Deposit.aggregate([
      { $match: pastYearMatch },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          depositCount: { $sum: 1 },
        },
      },
    ]),
    Investment.find({
      status: 'active',
      ledgerLockedAt: null,
    })
      .select('investmentCode sector partner amount profit returnMode societyOwnershipPct investorOwnershipPct societyAmount monthlyProfitTotal createdAt')
      .sort({ createdAt: -1 }),
  ]);

  const pastYearDeposits = {
    totalAmount: money(pastYearAgg[0]?.totalAmount || 0),
    depositCount: pastYearAgg[0]?.depositCount || 0,
    from: startYm,
    to: endYm,
    fetchedAt: new Date(),
  };

  const manualById = new Map(
    (Array.isArray(manualProjectValuations) ? manualProjectValuations : [])
      .filter((row) => row && (row.investmentId || row.investmentCode))
      .map((row) => [String(row.investmentId || row.investmentCode), row])
  );

  const projects = activeProjects.map((project) => {
    const key = String(project._id);
    const manual = manualById.get(key) || manualById.get(String(project.investmentCode || ''));
    const bookAmount = money(
      Number(project.societyAmount || 0) > 0
        ? project.societyAmount
        : (Number(project.amount || 0) * Number(project.societyOwnershipPct || 100)) / 100
    );
    const manualValuation = manual && manual.manualValuation != null && String(manual.manualValuation).trim() !== ''
      ? money(manual.manualValuation)
      : bookAmount;

    return {
      investmentId: project._id,
      investmentCode: project.investmentCode || '',
      label: [project.sector, project.partner].filter(Boolean).join(' · ') || project.investmentCode || 'Project',
      returnMode: project.returnMode || 'fixed_term',
      bookAmount,
      manualValuation,
      societyOwnershipPct: Number(project.societyOwnershipPct || 100),
      monthlyProfitTotal: money(project.monthlyProfitTotal),
      profitToDate: money(project.profit),
      isRunningMonthly: project.returnMode === 'monthly',
    };
  });

  const totalProjectValuation = money(projects.reduce((sum, p) => sum + Number(p.manualValuation || 0), 0));
  const runningMonthlyCount = projects.filter((p) => p.isRunningMonthly).length;

  return {
    pastYearDeposits,
    activeProjects: projects,
    totalProjectValuation,
    runningMonthlyCount,
  };
}

/**
 * Society fund valuation used for new-member buy-in / replacement entry.
 * join: equal share of (savings + profit + advance + active project valuations) ÷ active members
 * replacement: departing member's savings + profit + advance (seat settlement value)
 */
async function getEntryValuation({ replaceMemberId = null, manualProjectValuations = [] } = {}) {
  const activeMembers = await listActiveSocietyMembers();
  const totalSavings = money(activeMembers.reduce((sum, m) => sum + Number(m.savings || 0), 0));
  const totalProfit = money(activeMembers.reduce((sum, m) => sum + Number(m.profit || 0), 0));
  const totalAdvance = money(activeMembers.reduce((sum, m) => sum + Number(m.advanceBalance || 0), 0));
  const totalOpeningSavings = money(activeMembers.reduce((sum, m) => sum + Number(m.openingSavingsBalance || 0), 0));
  const totalOpeningProfit = money(activeMembers.reduce((sum, m) => sum + Number(m.openingProfitBalance || 0), 0));
  const totalMemberBalances = money(totalSavings + totalProfit + totalAdvance);
  const activeCount = activeMembers.length;

  const baseline = await getSocietyBaselineData({ manualProjectValuations });
  const totalProjectValuation = money(baseline.totalProjectValuation);
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
    // Align buy-in with existing members' cumulative savings + profits (+ project value) proportionally (equal share).
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
    totalOpeningSavings,
    totalOpeningProfit,
    totalProjectValuation,
    pastYearDeposits: baseline.pastYearDeposits,
    activeProjects: baseline.activeProjects,
    runningMonthlyCount: baseline.runningMonthlyCount,
    entryAmount,
    formula: mode === 'replacement'
      ? 'Departing member savings + profit + advance (exit settlement value)'
      : activeCount > 0
        ? 'Equal share = (member savings + profit + advance + active project valuations) ÷ active members — aligns new deposit with existing cumulative balances'
        : 'First member — no buy-in required (entry ৳0.00)',
    profitNote: baseline.runningMonthlyCount > 0
      ? `After activation, the new member receives running-project profits from next month onward, split by each member's savings+profit balance ratio (${baseline.runningMonthlyCount} monthly project(s) active).`
      : 'After activation, the new member receives society profit distributions from next month onward by savings+profit balance ratio.',
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
 * Complete share/entry buy-in after CEO approval.
 * Credits bank ledger, activates the account, sets next-month profit eligibility,
 * and syncs current-year contribution dues.
 */
async function completeMemberBuyIn({
  memberId,
  amountPaid,
  notes = '',
  recordedBy = 'Cashier',
  paymentMethod = 'cash',
  paymentReference = '',
} = {}) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $ne: 'deleted' },
  });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (member.status === 'pending' || member.status === 'submitted') {
    const error = new Error('CEO must approve this registration before payment can be confirmed.');
    error.status = 400;
    throw error;
  }

  const isCeoApproved = member.status === 'approved'
    || (member.status === 'inactive' && member.pendingEntryBuyIn && member.ceoApprovedAt);
  const isLegacyPending = member.status === 'inactive' && member.pendingEntryBuyIn;

  if (!isCeoApproved && !isLegacyPending) {
    if (member.status === 'active' && member.entryBuyInPaidAt) {
      const error = new Error('Buy-in already completed for this member.');
      error.status = 400;
      throw error;
    }
    const error = new Error('Member must be CEO-approved before payment confirmation.');
    error.status = 400;
    throw error;
  }

  const required = money(member.requiredEntryAmount || member.shareEntryAmount);
  const paid = money(amountPaid);

  if (!member.pendingEntryBuyIn && member.entryBuyInPaidAt) {
    const error = new Error('Buy-in already completed for this member.');
    error.status = 400;
    throw error;
  }

  if (!amountsMatch(paid, required)) {
    const error = new Error(
      `Payment must be exactly ${formatMoney(required, 2)} (manual share / entry fee). Received ${formatMoney(paid, 2)}.`
    );
    error.status = 400;
    throw error;
  }

  const channel = normalizePaymentChannel(paymentMethod, 'cash');
  const activatedAt = new Date();
  const profitEligibleFrom = getNextMonthStart(activatedAt);

  const deposit = await Deposit.create({
    member: member._id,
    amount: paid,
    type: 'member_buyin',
    notes: notes?.trim() || `Share / entry fee buy-in (${formatMoney(required, 2)}) via ${channel}`,
    recordedBy: String(recordedBy || '').trim(),
    paymentMethod: channel,
    paymentReference: String(paymentReference || '').trim(),
  });

  member.savings = money(Number(member.savings || 0) + paid);
  member.pendingEntryBuyIn = false;
  member.requiredEntryAmount = required;
  member.shareEntryAmount = required;
  member.entryBuyInPaidAt = activatedAt;
  member.profitEligibleFrom = profitEligibleFrom;
  member.status = 'active';

  // Credit historical opening balances captured at registration (once).
  const plannedOpeningSavings = money(member.registrationBaseline?.plannedOpeningSavings);
  const plannedOpeningProfit = money(member.registrationBaseline?.plannedOpeningProfit);
  const shouldApplyOpening = (plannedOpeningSavings > 0 || plannedOpeningProfit > 0)
    && !member.registrationBaseline?.openingBalancesApplied;
  if (shouldApplyOpening) {
    member.openingSavingsBalance = plannedOpeningSavings;
    member.openingProfitBalance = plannedOpeningProfit;
    member.openingBalanceSetAt = activatedAt;
    member.openingBalanceSetBy = String(recordedBy || 'Cashier').trim();
    member.savings = money(Number(member.savings || 0) + plannedOpeningSavings);
    member.profit = money(Number(member.profit || 0) + plannedOpeningProfit);
  }

  if (member.registrationBaseline && typeof member.registrationBaseline === 'object') {
    member.registrationBaseline = {
      ...member.registrationBaseline,
      openingBalancesApplied: Boolean(shouldApplyOpening || member.registrationBaseline.openingBalancesApplied),
      activatedAt,
      profitEligibleFrom,
      paymentMethod: channel,
    };
    member.markModified('registrationBaseline');
  }

  await member.save();

  if (shouldApplyOpening && plannedOpeningSavings > 0) {
    try {
      await Deposit.create({
        member: member._id,
        amount: plannedOpeningSavings,
        type: 'opening_balance',
        notes: 'Historical opening balance from member registration baseline',
        recordedBy: String(recordedBy || '').trim(),
        paymentMethod: channel,
        createdAt: activatedAt,
      });
    } catch (error) {
      console.warn('[completeMemberBuyIn] opening deposit create failed:', error.message);
    }
  }

  let bankLedger = null;
  if (paid > 0) {
    try {
      const { creditInbound } = require('./bankLedgerService');
      bankLedger = await creditInbound({
        type: 'deposit',
        amount: paid,
        referenceType: 'Deposit',
        referenceId: deposit._id,
        note: `Member share/entry payment: ${member.name}`,
        createdBy: recordedBy,
        paymentChannel: channel,
      });
    } catch (error) {
      console.warn('[completeMemberBuyIn] bank ledger credit failed:', error.message);
    }
  }

  let duesSync = null;
  try {
    duesSync = await syncNewMemberContributionDues(member);
  } catch (error) {
    console.warn('[completeMemberBuyIn] contribution dues sync failed:', error.message);
  }

  const valuationAfter = await getEntryValuation();

  try {
    const { createMemberNotification } = require('./memberNotificationService');
    await createMemberNotification({
      memberId: member._id,
      type: 'deposit',
      title: 'Membership Activated',
      message: `Your share/entry payment of ${formatMoney(paid, 2)} was confirmed (${channel}). Your account is now Active. Running project profits apply from ${profitEligibleFrom.toISOString().slice(0, 10)} onward.`,
      relatedId: deposit._id,
      relatedModel: 'Deposit',
    });
  } catch (error) {
    console.warn('[completeMemberBuyIn] member notification failed:', error.message);
  }

  return {
    member: member.toJSON(),
    deposit,
    bankLedger,
    valuationAmount: required,
    paymentMethod: channel,
    profitEligibleFrom,
    duesSync,
    valuationAfter,
    message: `Payment confirmed successfully via ${channel}. Member account is now Active. Running-project profits start next month (${profitEligibleFrom.toISOString().slice(0, 10)}).`,
  };
}

/**
 * Ensure the newly activated member has contribution due rows for the current year
 * (from join month through current month) so old + new member accounting stays consistent.
 */
async function syncNewMemberContributionDues(member) {
  const { getTargetForMonth, getOrCreateMemberDue, parseYearMonth } = require('./monthlyTargetService');
  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const joinDate = member.entryBuyInPaidAt || member.ceoApprovedAt || member.membershipSubmittedAt || member.createdAt || now;
  const join = new Date(joinDate);
  const startMonth = (join.getFullYear() === year) ? (join.getMonth() + 1) : 1;

  const months = [];
  for (let month = startMonth; month <= currentMonth; month += 1) {
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const target = await getTargetForMonth(yearMonth);
    if (target.amount == null) continue;
    const due = await getOrCreateMemberDue(member, yearMonth, target.amount);
    months.push({
      yearMonth: parseYearMonth(yearMonth).yearMonth,
      expectedAmount: money(due.expectedAmount),
      unpaidAmount: money(due.unpaidAmount),
      status: due.status,
    });
  }

  return {
    year,
    monthsSynced: months.length,
    months,
  };
}

/**
 * Submit a newly created member for CEO approval with a manual share/entry amount.
 * Captures past-year deposit baseline, optional manual project valuations, and opening balances.
 * Does not activate the account — CEO approval + payment confirmation are required.
 */
async function prepareMemberForBuyIn(userDoc, {
  shareEntryAmount = null,
  entryAmountPaid = null,
  recordedBy = '',
  manualProjectValuations = [],
  openingSavings = null,
  openingProfit = null,
} = {}) {
  const valuation = await getEntryValuation({ manualProjectValuations });
  const suggested = money(valuation.entryAmount);

  const hasManual = shareEntryAmount !== null && shareEntryAmount !== undefined && String(shareEntryAmount).trim() !== '';
  // Prefer explicit manual share; fall back to legacy entryAmountPaid only as the declared share amount (not instant pay).
  const rawManual = hasManual ? shareEntryAmount : entryAmountPaid;
  if (rawManual === null || rawManual === undefined || String(rawManual).trim() === '') {
    const error = new Error('Share / entry fee amount is required. Enter the amount manually (suggested valuation is shown for reference only).');
    error.status = 400;
    throw error;
  }

  const manual = money(rawManual);
  if (manual < 0 || Number.isNaN(manual)) {
    const error = new Error('Share / entry fee amount must be zero or greater.');
    error.status = 400;
    throw error;
  }

  const openingSavingsAmt = openingSavings != null && String(openingSavings).trim() !== ''
    ? money(openingSavings)
    : null;
  const openingProfitAmt = openingProfit != null && String(openingProfit).trim() !== ''
    ? money(openingProfit)
    : null;
  if (openingSavingsAmt != null && openingSavingsAmt < 0) {
    const error = new Error('Opening savings cannot be negative.');
    error.status = 400;
    throw error;
  }
  if (openingProfitAmt != null && openingProfitAmt < 0) {
    const error = new Error('Opening profit cannot be negative.');
    error.status = 400;
    throw error;
  }

  const projectRows = (valuation.activeProjects || []).map((project) => {
    const override = (Array.isArray(manualProjectValuations) ? manualProjectValuations : [])
      .find((row) => String(row.investmentId || '') === String(project.investmentId)
        || String(row.investmentCode || '') === String(project.investmentCode || ''));
    const manualValuation = override && override.manualValuation != null && String(override.manualValuation).trim() !== ''
      ? money(override.manualValuation)
      : money(project.manualValuation);
    return {
      investmentId: project.investmentId,
      investmentCode: project.investmentCode,
      label: project.label,
      bookAmount: money(project.bookAmount),
      manualValuation,
    };
  });

  userDoc.shareEntryAmount = manual;
  userDoc.requiredEntryAmount = manual;
  userDoc.pendingEntryBuyIn = true;
  userDoc.status = 'pending';
  userDoc.membershipSubmittedAt = new Date();
  userDoc.ceoApprovedAt = null;
  userDoc.ceoApprovedBy = '';
  userDoc.membershipRejectionReason = '';
  userDoc.entryBuyInPaidAt = null;
  userDoc.profitEligibleFrom = null;
  userDoc.manualProjectValuations = projectRows;
  userDoc.registrationBaseline = {
    capturedAt: new Date(),
    recordedBy: String(recordedBy || '').trim(),
    pastYearDeposits: valuation.pastYearDeposits,
    activeProjects: projectRows,
    totalProjectValuation: money(projectRows.reduce((sum, p) => sum + Number(p.manualValuation || 0), 0)),
    totalSavings: valuation.totalSavings,
    totalProfit: valuation.totalProfit,
    totalAdvance: valuation.totalAdvance,
    totalFund: valuation.totalFund,
    suggestedEntryAmount: suggested,
    finalSharePrice: manual,
    activeCount: valuation.activeCount,
    formula: valuation.formula,
    profitNote: valuation.profitNote,
    plannedOpeningSavings: openingSavingsAmt != null ? openingSavingsAmt : 0,
    plannedOpeningProfit: openingProfitAmt != null ? openingProfitAmt : 0,
    openingBalancesApplied: false,
  };

  await userDoc.save();

  try {
    const { createAdminNotification } = require('./adminNotificationService');
    await createAdminNotification({
      type: 'general',
      title: `New member registration: ${userDoc.name}`,
      message: `${userDoc.name} (${userDoc.email}) was submitted with manual share/entry fee ${formatMoney(manual, 2)} (suggested ${formatMoney(suggested, 2)}). Past-year deposits ${formatMoney(valuation.pastYearDeposits?.totalAmount || 0, 2)}. Awaiting CEO approval.`,
      relatedId: userDoc._id,
      relatedModel: 'User',
    });
  } catch (error) {
    console.warn('[prepareMemberForBuyIn] admin notification failed:', error.message);
  }

  return {
    member: userDoc,
    valuation: {
      ...valuation,
      suggestedEntryAmount: suggested,
      entryAmount: manual,
      manual: true,
      formula: `Manual share/entry fee ${formatMoney(manual, 2)} (suggested equal-share ${formatMoney(suggested, 2)})`,
    },
    buyIn: null,
    activated: false,
    message: `Member submitted as Pending. CEO must approve, then cashier confirms payment of ${formatMoney(manual, 2)} before the account becomes Active. Running-project profits apply from the month after activation.`,
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

async function listPendingMemberRegistrations() {
  const members = await User.find({
    role: 'member',
    status: { $in: ['pending', 'submitted'] },
  }).select('-password').sort({ membershipSubmittedAt: -1, createdAt: -1 });

  return members.map((m) => ({
    id: m._id,
    name: m.name,
    email: m.email,
    phone: m.phone || '',
    status: m.status,
    statusLabel: 'Pending / Submitted',
    shareEntryAmount: money(m.shareEntryAmount || m.requiredEntryAmount),
    requiredEntryAmount: money(m.requiredEntryAmount || m.shareEntryAmount),
    membershipSubmittedAt: m.membershipSubmittedAt || m.createdAt,
    createdAt: m.createdAt,
    registrationBaseline: m.registrationBaseline || null,
    openingSavingsBalance: money(m.openingSavingsBalance),
    openingProfitBalance: money(m.openingProfitBalance),
  }));
}

/**
 * CEO approves a pending registration → status becomes Approved (awaiting payment confirmation).
 * Zero share amount auto-activates after CEO approval.
 */
async function approveMemberRegistration(memberId, { approvedBy = 'CEO' } = {}) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['pending', 'submitted'] },
  });
  if (!member) {
    const error = new Error('Pending member registration not found.');
    error.status = 404;
    throw error;
  }

  const required = money(member.requiredEntryAmount || member.shareEntryAmount);
  member.status = 'approved';
  member.ceoApprovedAt = new Date();
  member.ceoApprovedBy = String(approvedBy || 'CEO').trim();
  member.pendingEntryBuyIn = true;
  member.requiredEntryAmount = required;
  member.shareEntryAmount = required;
  member.membershipRejectionReason = '';
  await member.save();

  try {
    const { createAdminNotification } = require('./adminNotificationService');
    await createAdminNotification({
      type: 'general',
      title: `Member approved: ${member.name}`,
      message: required > 0
        ? `${member.name} was approved by CEO. Cashier may now confirm share/entry payment of ${formatMoney(required, 2)}.`
        : `${member.name} was approved by CEO with ৳0 share fee — account will activate.`,
      relatedId: member._id,
      relatedModel: 'User',
    });
  } catch (error) {
    console.warn('[approveMemberRegistration] notification failed:', error.message);
  }

  if (required <= 0) {
    const buyIn = await completeMemberBuyIn({
      memberId: member._id,
      amountPaid: 0,
      recordedBy: approvedBy,
      notes: 'Zero share/entry fee — activated on CEO approval',
    });
    return {
      member: buyIn.member,
      buyIn,
      activated: true,
      awaitingPayment: false,
      message: 'CEO approved. Zero share fee — member account is now Active.',
    };
  }

  return {
    member: member.toJSON(),
    buyIn: null,
    activated: false,
    awaitingPayment: true,
    message: `CEO approved. Cashier can now confirm successful payment of ${formatMoney(required, 2)}.`,
  };
}

async function rejectMemberRegistration(memberId, { rejectedBy = 'CEO', reason = '' } = {}) {
  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['pending', 'submitted', 'approved'] },
  });
  if (!member) {
    const error = new Error('Member registration not found.');
    error.status = 404;
    throw error;
  }

  member.status = 'blocked';
  member.pendingEntryBuyIn = false;
  member.membershipRejectionReason = String(reason || 'Registration rejected by CEO').trim();
  member.ceoApprovedAt = null;
  member.ceoApprovedBy = '';
  await member.save();

  return {
    member: member.toJSON(),
    message: 'Member registration rejected. Account is blocked.',
  };
}

async function listPendingBuyInMembers() {
  const members = await User.find({
    role: 'member',
    pendingEntryBuyIn: true,
    status: 'approved',
  }).select('-password').sort({ ceoApprovedAt: -1, createdAt: -1 });

  // Include legacy inactive pending buy-ins (pre-workflow) so cashiers can finish them.
  const legacy = await User.find({
    role: 'member',
    pendingEntryBuyIn: true,
    status: 'inactive',
  }).select('-password').sort({ createdAt: -1 });

  const merged = [...members, ...legacy.filter((m) => !members.some((x) => String(x._id) === String(m._id)))];

  return merged.map((m) => ({
    id: m._id,
    name: m.name,
    email: m.email,
    status: m.status,
    statusLabel: m.status === 'approved' ? 'Approved — awaiting payment' : 'Legacy pending buy-in',
    shareEntryAmount: money(m.shareEntryAmount || m.requiredEntryAmount),
    requiredEntryAmount: money(m.requiredEntryAmount || m.shareEntryAmount),
    ceoApprovedAt: m.ceoApprovedAt,
    ceoApprovedBy: m.ceoApprovedBy || '',
    membershipSubmittedAt: m.membershipSubmittedAt || m.createdAt,
    createdAt: m.createdAt,
  }));
}

async function getMigrationOverview() {
  const members = await User.find({ role: 'member', status: { $ne: 'deleted' } })
    .select('name email savings profit advanceBalance openingSavingsBalance openingProfitBalance openingBalanceSetAt status pendingEntryBuyIn requiredEntryAmount shareEntryAmount ceoApprovedAt membershipSubmittedAt')
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
    if (m.pendingEntryBuyIn && m.status === 'approved') acc.pendingBuyInCount += 1;
    if (m.status === 'pending' || m.status === 'submitted') acc.pendingRegistrationCount += 1;
    return acc;
  }, {
    savings: 0,
    profit: 0,
    advance: 0,
    openingSavings: 0,
    openingProfit: 0,
    migratedCount: 0,
    pendingBuyInCount: 0,
    pendingRegistrationCount: 0,
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
      pendingEntryBuyIn: Boolean(m.pendingEntryBuyIn),
      requiredEntryAmount: money(m.requiredEntryAmount),
    })),
    totals: {
      totalSavings: money(totals.savings),
      totalProfit: money(totals.profit),
      totalAdvance: money(totals.advance),
      totalOpeningSavings: money(totals.openingSavings),
      totalOpeningProfit: money(totals.openingProfit),
      migratedMemberCount: totals.migratedCount,
      pendingBuyInCount: totals.pendingBuyInCount,
      pendingRegistrationCount: totals.pendingRegistrationCount,
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
  getNextMonthStart,
  yearMonthRangeForPastYear,
  listActiveSocietyMembers,
  getSocietyBaselineData,
  getEntryValuation,
  setMemberOpeningBalances,
  replaceMember,
  exitMemberViaSocietyFund,
  getMigrationOverview,
  completeMemberBuyIn,
  prepareMemberForBuyIn,
  listPendingBuyInMembers,
  listPendingMemberRegistrations,
  approveMemberRegistration,
  rejectMemberRegistration,
  syncNewMemberContributionDues,
};
