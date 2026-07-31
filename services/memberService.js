const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const Notice = require('../models/Notice');
const { getRefundsByMember } = require('./refundService');
const {
  yearMonthFromDate,
  applyDepositToMonthlyDue,
  getTargetForMonth,
} = require('./monthlyTargetService');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

async function getDuesAlert(memberData = {}, now = new Date()) {
  const dueDay = 15;
  const yearMonth = yearMonthFromDate(now);
  const memberId = memberData.memberId || memberData.member?._id || memberData._id;

  if (memberId) {
    try {
      const { getMemberArrearsSummary } = require('./monthlyTargetService');
      const arrears = await getMemberArrearsSummary(memberId, { asOfDate: now });
      const isOverdue = now.getDate() > dueDay && money(arrears.currentMonthUnpaid) > 0;
      if (arrears.hasArrears || money(arrears.totalDue) > 0) {
        return {
          isOverdue: isOverdue || arrears.hasArrears,
          message: arrears.memberMessage
            || (isOverdue
              ? `Your dues are overdue. Remaining for ${yearMonth}: ${formatMoney(money(arrears.currentMonthUnpaid), 2)}.`
              : ''),
          dueDay,
          yearMonth,
          unpaidAmount: money(arrears.totalDue),
          previousMonthsCount: arrears.previousMonthsCount,
          currentMonthUnpaid: money(arrears.currentMonthUnpaid),
          totalDue: money(arrears.totalDue),
          hasArrears: arrears.hasArrears,
          arrears,
        };
      }
      return {
        isOverdue: false,
        message: '',
        dueDay,
        yearMonth,
        unpaidAmount: 0,
        previousMonthsCount: 0,
        currentMonthUnpaid: 0,
        totalDue: 0,
        hasArrears: false,
        arrears,
      };
    } catch (error) {
      // fall through to deposit presence check
    }
  }

  const deposits = Array.isArray(memberData.deposits) ? memberData.deposits : [];
  const currentMonthDeposit = deposits.some((deposit) => {
    const date = deposit.createdAt ? new Date(deposit.createdAt) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return false;
    }
    return yearMonthFromDate(date) === yearMonth;
  });

  const isOverdue = now.getDate() > dueDay && !currentMonthDeposit;

  return {
    isOverdue,
    message: isOverdue ? 'Your dues are overdue. Please deposit before the next cycle.' : '',
    dueDay,
    yearMonth,
    unpaidAmount: null,
    previousMonthsCount: 0,
    hasArrears: false,
  };
}

/**
 * Record a member deposit. For regular monthly deposits with a configured month target:
 * - amount up to remaining target → savings
 * - surplus above target → advanceBalance
 * - shortfall → MonthlyContributionDue.unpaidAmount
 */
async function saveDeposit(memberId, amount, options = {}) {
  const { normalizePaymentChannel } = require('./paymentChannelService');
  const { generateReceiptNumber } = require('./receiptService');
  const { bindSession, sessionOpt, createWithSession } = require('./mongoTransaction');
  const session = options.session || null;

  const member = await bindSession(
    User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } }),
    session
  );
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }
  if (member.status && member.status !== 'active') {
    const error = new Error('Only active members can receive deposits.');
    error.status = 400;
    throw error;
  }

  const total = money(amount);
  if (!(total > 0)) {
    const error = new Error('Deposit amount must be a positive number.');
    error.status = 400;
    throw error;
  }

  const depositType = options.type || 'regular';
  const yearMonth = options.yearMonth || yearMonthFromDate(options.depositDate || new Date());
  const recordedBy = options.recordedBy || '';
  const paymentMethod = normalizePaymentChannel(options.paymentMethod);
  const paymentReference = options.paymentReference?.trim() || '';
  const receiptNumber = await generateReceiptNumber('DEP', { session });
  const depositExtras = {
    paymentMethod,
    paymentReference,
    receiptNumber,
  };

  let towardTarget = total;
  let surplus = 0;
  let monthlySplit = null;
  let advanceDeposit = null;
  let due = null;

  if (depositType === 'regular') {
    monthlySplit = await applyDepositToMonthlyDue({
      member,
      amount: total,
      yearMonth,
      session,
    });
    towardTarget = monthlySplit.towardTarget;
    surplus = monthlySplit.surplus;
    due = monthlySplit.due;
  }

  const notesBase = options.notes || '';
  let regularNotes = notesBase;
  if (monthlySplit?.splitApplied) {
    const parts = [
      notesBase,
      `Month ${monthlySplit.yearMonth} target ${formatMoney(money(monthlySplit.targetAmount), 2)}`,
      towardTarget > 0 ? `fixed deposit ${formatMoney(towardTarget, 2)}` : null,
      surplus > 0 ? `surplus ${formatMoney(surplus, 2)} → advance` : null,
      monthlySplit.remainingUnpaid > 0
        ? `still due ${formatMoney(monthlySplit.remainingUnpaid, 2)}`
        : null,
    ].filter(Boolean);
    regularNotes = parts.join(' · ');
  }

  let deposit = null;
  let savingsInc = 0;
  let advanceInc = 0;

  if (depositType === 'regular') {
    if (towardTarget > 0) {
      deposit = await createWithSession(Deposit, {
        member: member._id,
        amount: towardTarget,
        type: 'regular',
        yearMonth: monthlySplit?.yearMonth || yearMonth,
        towardTarget,
        surplusToAdvance: 0,
        notes: regularNotes,
        recordedBy,
        ...depositExtras,
      }, session);
      savingsInc = money(savingsInc + towardTarget);
    }

    if (surplus > 0) {
      const advanceReceiptNumber = towardTarget > 0
        ? await generateReceiptNumber('DEP', { session })
        : receiptNumber;
      advanceDeposit = await createWithSession(Deposit, {
        member: member._id,
        amount: surplus,
        type: 'advance',
        yearMonth: monthlySplit?.yearMonth || yearMonth,
        towardTarget: 0,
        surplusToAdvance: surplus,
        notes: notesBase
          || `Surplus above ${monthlySplit?.yearMonth || yearMonth} fixed target of ${formatMoney(money(monthlySplit?.targetAmount), 2)} → advance balance`,
        recordedBy,
        paymentMethod,
        paymentReference,
        receiptNumber: advanceReceiptNumber,
      }, session);
      advanceInc = money(advanceInc + surplus);
    }

    // No target configured: entire amount to savings as a single regular deposit
    if (!monthlySplit?.splitApplied && !deposit) {
      deposit = await createWithSession(Deposit, {
        member: member._id,
        amount: total,
        type: 'regular',
        yearMonth,
        notes: notesBase,
        recordedBy,
        ...depositExtras,
      }, session);
      savingsInc = money(total);
    }
  } else if (depositType === 'advance') {
    deposit = await createWithSession(Deposit, {
      member: member._id,
      amount: total,
      type: 'advance',
      yearMonth,
      notes: notesBase || 'Advance / surplus deposit',
      recordedBy,
      ...depositExtras,
    }, session);
    advanceInc = money(total);
  } else {
    deposit = await createWithSession(Deposit, {
      member: member._id,
      amount: total,
      type: depositType,
      yearMonth,
      notes: notesBase,
      recordedBy,
      ...depositExtras,
    }, session);
    savingsInc = money(total);
  }

  // Atomic $inc prevents lost updates when two deposits hit the same member concurrently.
  const updatedMember = await User.findOneAndUpdate(
    { _id: member._id, role: 'member', status: { $ne: 'deleted' } },
    {
      $inc: {
        ...(savingsInc > 0 ? { savings: savingsInc } : {}),
        ...(advanceInc > 0 ? { advanceBalance: advanceInc } : {}),
      },
    },
    sessionOpt(session, { new: true })
  );

  if (!updatedMember) {
    const error = new Error('Unable to update member balances.');
    error.status = 409;
    throw error;
  }

  let bankLedger = null;
  let ledgerWarning = null;
  if (!options.skipBankCredit) {
    try {
      const { creditDeposit } = require('./bankLedgerService');
      bankLedger = await creditDeposit({
        type: 'deposit',
        amount: total,
        referenceType: 'Deposit',
        referenceId: (deposit || advanceDeposit)?._id,
        note: surplus > 0 && towardTarget > 0
          ? `Member deposit: ${updatedMember.name} (${yearMonth}) — ${formatMoney(towardTarget, 2)} fixed + ${formatMoney(surplus, 2)} advance`
          : surplus > 0
            ? `Member advance surplus: ${updatedMember.name} (${yearMonth})`
            : `Member deposit: ${updatedMember.name} (${yearMonth})`,
        createdBy: recordedBy || 'Admin',
        paymentChannel: paymentMethod,
        paymentReference,
        session,
      });
    } catch (error) {
      console.error('[saveDeposit] bank ledger credit failed:', error.message);
      // Inside a transaction this aborts the whole payment; outside, warn not to resubmit blindly.
      const wrapped = new Error(
        session
          ? `Bank ledger credit failed during deposit transaction: ${error.message}`
          : `Deposit recorded for the member, but bank ledger credit failed: ${error.message}. Do not resubmit; reconcile the ledger.`
      );
      wrapped.status = error.status || 500;
      if (!session) {
        wrapped.partialDeposit = {
          deposit: deposit || advanceDeposit,
          regularDeposit: deposit || null,
          advanceDeposit: advanceDeposit || null,
          member: updatedMember,
        };
      }
      throw wrapped;
    }
  }

  const primaryDeposit = deposit || advanceDeposit;
  if (!options.skipBankCredit && !session) {
    void (async () => {
    try {
      const { notifyDepositRecorded } = require('./financialNotificationService');
      const { recordAdminActivity } = require('./activityLogService');
      await notifyDepositRecorded({
        member: updatedMember,
        deposit: primaryDeposit,
        recordedBy,
        receiptNumber: primaryDeposit?.receiptNumber || receiptNumber,
        paymentMethod,
      });
      await recordAdminActivity({
        action: 'deposit_recorded',
        actor: options.actor || null,
        targetUserId: updatedMember._id,
        targetEmail: updatedMember.email,
        details: {
          amount: total,
          towardTarget,
          surplus,
          paymentMethod,
          paymentReference,
          receiptNumber: primaryDeposit?.receiptNumber || receiptNumber,
          yearMonth,
        },
        ip: options.ip || '',
      });
    } catch (notifyError) {
      console.warn('[saveDeposit] notification/audit failed:', notifyError.message);
    }
  })();
  }

  return {
    deposit: primaryDeposit,
    regularDeposit: deposit || null,
    advanceDeposit: advanceDeposit || null,
    member: updatedMember,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? null,
    ledgerWarning,
    split: {
      total,
      towardTarget,
      surplus,
      savingsCredited: savingsInc,
      advanceCredited: advanceInc,
    },
    monthlySplit: monthlySplit
      ? {
        yearMonth: monthlySplit.yearMonth,
        targetAmount: monthlySplit.targetAmount,
        towardTarget,
        surplus,
        remainingUnpaid: monthlySplit.remainingUnpaid,
        splitApplied: monthlySplit.splitApplied,
        dueStatus: due?.status || null,
      }
      : null,
  };
}

async function getSummary() {
  const [memberAgg, deletedMembers, totalDeposits, notices, activeMonthTarget] = await Promise.all([
    User.aggregate([
      { $match: { role: 'member', status: { $ne: 'deleted' } } },
      {
        $group: {
          _id: null,
          totalMembers: { $sum: 1 },
          activeMembers: {
            $sum: {
              $cond: [{ $eq: [{ $ifNull: ['$status', 'active'] }, 'active'] }, 1, 0],
            },
          },
          totalSavings: { $sum: { $ifNull: ['$savings', 0] } },
          totalProfit: { $sum: { $ifNull: ['$profit', 0] } },
        },
      },
    ]),
    User.countDocuments({ role: 'member', status: 'deleted' }),
    Deposit.countDocuments(),
    Notice.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    getTargetForMonth(),
  ]);

  const totals = memberAgg[0] || {};
  const totalMembers = totals.totalMembers || 0;
  const activeMembers = totals.activeMembers || 0;

  return {
    totalMembers,
    activeMembers,
    inactiveMembers: Math.max(totalMembers - activeMembers, 0),
    deletedMembers,
    totalDeposits,
    totalSavings: Number(totals.totalSavings || 0),
    totalProfit: Number(totals.totalProfit || 0),
    notices,
    monthlyContributionAmount: activeMonthTarget.amount,
    activeMonthTarget,
  };
}

async function getNotices() {
  return Notice.find({}).sort({ createdAt: -1 }).limit(10);
}

async function createNotice(payload) {
  return Notice.create(payload);
}

function buildMemberAvatar(member, size = 48) {
  const initials = (member?.name || 'M').split(' ').slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'M';
  const palette = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6'];
  const background = palette[(member?.name?.length || 0) % palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${size / 2}" fill="${background}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="${Math.max(16, size * 0.35)}" fill="white" font-family="Arial, sans-serif">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getMemberAvatar(member, size = 48) {
  if (member?.profilePicture) {
    return member.profilePicture;
  }
  return buildMemberAvatar(member, size);
}

function buildMonthlyDepositHistory(deposits = [], now = new Date(), duesByMonth = new Map()) {
  const history = [];
  const current = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let index = 11; index >= 0; index -= 1) {
    const monthDate = new Date(current.getFullYear(), current.getMonth() - index, 1);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
    const yearMonth = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const monthDeposits = deposits.filter((deposit) => {
      if (deposit.yearMonth && deposit.yearMonth === yearMonth) return true;
      const createdAt = deposit.createdAt ? new Date(deposit.createdAt) : null;
      return createdAt && createdAt >= monthStart && createdAt < monthEnd;
    });
    const totalAmount = monthDeposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const regularAmount = monthDeposits
      .filter((d) => !d.type || d.type === 'regular')
      .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const advanceAmount = monthDeposits
      .filter((d) => d.type === 'advance')
      .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const due = duesByMonth.get(yearMonth);

    let status = monthDeposits.length > 0 ? 'completed' : 'missed';
    if (due) {
      if (due.status === 'paid') status = 'paid';
      else if (due.status === 'partial') status = 'partial';
      else if (money(due.unpaidAmount) > 0) status = 'unpaid';
      else status = due.status || status;
    }

    history.push({
      label: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      yearMonth,
      status,
      amount: money(totalAmount),
      regularAmount: money(due ? due.paidAmount : regularAmount),
      advanceAmount: money(due ? due.surplusToAdvance : advanceAmount),
      expectedAmount: due ? money(due.expectedAmount) : null,
      unpaidAmount: due ? money(due.unpaidAmount) : null,
      deposits: monthDeposits,
    });
  }

  return history;
}

async function getMemberProfileData(memberId, now = new Date()) {
  const member = await User.findById(memberId).select('-password');
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  const MonthlyContributionDue = require('../models/MonthlyContributionDue');
  const {
    yearMonthFromDate,
    getTargetForMonth,
    getOrCreateMemberDue,
  } = require('./monthlyTargetService');

  const deposits = await Deposit.find({ member: memberId }).sort({ createdAt: -1 });
  const refunds = await getRefundsByMember(memberId);
  const contributionDues = await MonthlyContributionDue.find({ member: memberId })
    .sort({ yearMonth: -1 })
    .lean();

  const yearMonth = yearMonthFromDate(now);
  const activeTarget = await getTargetForMonth(yearMonth);

  let currentDue = contributionDues.find((d) => d.yearMonth === yearMonth) || null;
  if (!currentDue && activeTarget.amount != null && member.role === 'member' && member.status !== 'deleted') {
    const created = await getOrCreateMemberDue(member, yearMonth, activeTarget.amount);
    currentDue = created.toObject ? created.toObject() : created;
  }

  const duesByMonth = new Map(
    (currentDue && !contributionDues.some((d) => d.yearMonth === yearMonth)
      ? [...contributionDues, currentDue]
      : contributionDues
    ).map((d) => [d.yearMonth, d])
  );

  const monthlyHistory = buildMonthlyDepositHistory(deposits, now, duesByMonth);
  const completedPayments = monthlyHistory.filter((item) => ['completed', 'paid'].includes(item.status)).length;
  const missedPayments = monthlyHistory.filter((item) => ['missed', 'unpaid'].includes(item.status)).length;

  const currentMonthStatus = {
    yearMonth,
    monthLabel: activeTarget.monthLabel,
    targetAmount: activeTarget.amount,
    targetSource: activeTarget.source,
    paidAmount: currentDue ? money(currentDue.paidAmount) : 0,
    unpaidAmount: currentDue
      ? money(currentDue.unpaidAmount)
      : (activeTarget.amount != null ? money(activeTarget.amount) : 0),
    surplusToAdvance: currentDue ? money(currentDue.surplusToAdvance) : 0,
    status: currentDue?.status
      || (activeTarget.amount == null ? 'no_target' : 'unpaid'),
  };

  return {
    member,
    deposits,
    refunds,
    monthlyHistory,
    contributionDues: contributionDues.map((d) => ({
      id: d._id,
      yearMonth: d.yearMonth,
      expectedAmount: money(d.expectedAmount),
      paidAmount: money(d.paidAmount),
      unpaidAmount: money(d.unpaidAmount),
      surplusToAdvance: money(d.surplusToAdvance),
      status: d.status,
      updatedAt: d.updatedAt,
    })),
    currentMonthStatus,
    advanceBalance: money(member.advanceBalance),
    completedPayments,
    missedPayments,
    totalDeposits: money(deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0)),
    totalRefunded: money(refunds
      .filter((refund) => refund.status === 'completed')
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0)),
  };
}

async function setMemberStatus(memberId, status) {
  const allowedStatuses = ['active', 'inactive'];
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid member status.');
    error.status = 400;
    throw error;
  }

  const member = await User.findOneAndUpdate(
    { _id: memberId, role: 'member', status: { $ne: 'deleted' } },
    { status },
    { new: true, runValidators: true }
  ).select('-password');

  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  return member;
}

module.exports = {
  saveDeposit,
  getSummary,
  getDuesAlert,
  getNotices,
  createNotice,
  buildMemberAvatar,
  getMemberAvatar,
  getMemberProfileData,
  setMemberStatus,
};
