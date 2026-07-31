const MonthlyContributionTarget = require('../models/MonthlyContributionTarget');
const MonthlyContributionDue = require('../models/MonthlyContributionDue');
const User = require('../models/User');
const { getMonthlyContributionAmount } = require('./societyConfig');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function yearMonthFromDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseYearMonth(yearMonth) {
  const key = String(yearMonth || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) {
    const error = new Error('yearMonth must be YYYY-MM.');
    error.status = 400;
    throw error;
  }
  const [y, m] = key.split('-').map(Number);
  if (m < 1 || m > 12) {
    const error = new Error('Invalid month in yearMonth.');
    error.status = 400;
    throw error;
  }
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 1);
  const monthLabel = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { yearMonth: key, year: y, month: m, monthStart, monthEnd, monthLabel };
}

function dueStatus(expected, paid) {
  const e = money(expected);
  const p = money(paid);
  if (e <= 0 || p >= e) return 'paid';
  if (p > 0) return 'partial';
  return 'unpaid';
}

/**
 * Resolve target amount for a month: DB override → env MONTHLY_CONTRIBUTION fallback → null.
 */
async function getTargetForMonth(yearMonth = yearMonthFromDate()) {
  const { yearMonth: key, monthLabel } = parseYearMonth(yearMonth);
  const doc = await MonthlyContributionTarget.findOne({ yearMonth: key }).lean();
  const envFallback = getMonthlyContributionAmount();

  if (doc) {
    return {
      yearMonth: key,
      monthLabel,
      amount: money(doc.amount),
      source: 'configured',
      notes: doc.notes || '',
      setBy: doc.setBy || '',
      setAt: doc.setAt || doc.updatedAt || null,
      configured: true,
    };
  }

  if (envFallback != null) {
    return {
      yearMonth: key,
      monthLabel,
      amount: money(envFallback),
      source: 'env_fallback',
      notes: 'Fallback from MONTHLY_CONTRIBUTION env',
      setBy: 'system',
      setAt: null,
      configured: false,
    };
  }

  return {
    yearMonth: key,
    monthLabel,
    amount: null,
    source: 'none',
    notes: '',
    setBy: '',
    setAt: null,
    configured: false,
  };
}

async function listTargets({ limit = 24 } = {}) {
  const rows = await MonthlyContributionTarget.find({})
    .sort({ yearMonth: -1 })
    .limit(Math.min(Number(limit) || 24, 120))
    .lean();

  return rows.map((row) => ({
    id: row._id,
    yearMonth: row.yearMonth,
    amount: money(row.amount),
    notes: row.notes || '',
    setBy: row.setBy || '',
    setAt: row.setAt || row.updatedAt,
    monthLabel: parseYearMonth(row.yearMonth).monthLabel,
  }));
}

/**
 * Create or update the mandatory fixed target for a specific month,
 * then sync unpaid dues for all active members.
 */
async function upsertTarget({
  yearMonth,
  amount,
  notes = '',
  setBy = 'Admin',
  syncDues = true,
} = {}) {
  const { yearMonth: key, monthLabel } = parseYearMonth(yearMonth);
  const normalized = money(amount);
  if (normalized < 0) {
    const error = new Error('Target amount cannot be negative.');
    error.status = 400;
    throw error;
  }

  const doc = await MonthlyContributionTarget.findOneAndUpdate(
    { yearMonth: key },
    {
      $set: {
        amount: normalized,
        notes: String(notes || '').trim(),
        setBy: String(setBy || 'Admin').trim(),
        setAt: new Date(),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        yearMonth: key,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  let duesSync = null;
  if (syncDues) {
    duesSync = await syncMonthDues(key, { expectedAmount: normalized });
  }

  return {
    target: {
      id: doc._id,
      yearMonth: doc.yearMonth,
      amount: money(doc.amount),
      notes: doc.notes || '',
      setBy: doc.setBy || '',
      setAt: doc.setAt,
      monthLabel,
      source: 'configured',
      configured: true,
    },
    duesSync,
  };
}

async function getOrCreateMemberDue(member, yearMonth, expectedAmount, { session = null } = {}) {
  const { bindSession, sessionOpt, createWithSession } = require('./mongoTransaction');
  const { yearMonth: key } = parseYearMonth(yearMonth);
  const expected = money(expectedAmount);
  let due = await bindSession(
    MonthlyContributionDue.findOne({ member: member._id, yearMonth: key }),
    session
  );

  if (!due) {
    due = await createWithSession(MonthlyContributionDue, {
      member: member._id,
      memberName: member.name || '',
      yearMonth: key,
      expectedAmount: expected,
      paidAmount: 0,
      unpaidAmount: expected,
      surplusToAdvance: 0,
      status: dueStatus(expected, 0),
    }, session);
    return due;
  }

  // If target changed and member hasn't paid yet, refresh expected; if partially paid, keep paid and recalc unpaid
  if (money(due.expectedAmount) !== expected) {
    due.expectedAmount = expected;
    due.unpaidAmount = money(Math.max(0, expected - money(due.paidAmount)));
    due.status = due.borrowing && due.status === 'settled'
      ? 'settled'
      : dueStatus(expected, due.paidAmount);
    due.memberName = member.name || due.memberName;
    await due.save(sessionOpt(session));
  }

  return due;
}

/**
 * Ensure every active member has a due row for the month at the given (or current) target.
 */
async function syncMonthDues(yearMonth, { expectedAmount = null } = {}) {
  const target = expectedAmount != null
    ? { amount: money(expectedAmount) }
    : await getTargetForMonth(yearMonth);

  if (target.amount == null) {
    return { synced: 0, skipped: true, reason: 'No target configured for this month.' };
  }

  const members = await User.find({ role: 'member', status: 'active' }).select('name');
  let created = 0;
  let updated = 0;

  for (const member of members) {
    const before = await MonthlyContributionDue.findOne({
      member: member._id,
      yearMonth: parseYearMonth(yearMonth).yearMonth,
    });
    await getOrCreateMemberDue(member, yearMonth, target.amount);
    if (!before) created += 1;
    else updated += 1;
  }

  return {
    synced: members.length,
    created,
    updated,
    yearMonth: parseYearMonth(yearMonth).yearMonth,
    expectedAmount: money(target.amount),
  };
}

/**
 * Pure split of a cashier deposit against remaining monthly target due.
 * towardTarget → regular fixed deposit / savings
 * surplus → member advanceBalance
 */
function computeMonthlyDepositSplit(totalAmount, remainingDue, targetAmount = null) {
  const total = money(totalAmount);
  if (!(total > 0)) {
    return {
      towardTarget: 0,
      surplus: 0,
      remainingUnpaid: money(Math.max(0, money(remainingDue))),
      splitApplied: targetAmount != null && targetAmount !== '',
    };
  }

  if (targetAmount == null || targetAmount === '') {
    return {
      towardTarget: total,
      surplus: 0,
      remainingUnpaid: 0,
      splitApplied: false,
    };
  }

  const remaining = money(Math.max(0, money(remainingDue)));
  const towardTarget = money(Math.min(total, remaining));
  const surplus = money(Math.max(0, total - towardTarget));
  const remainingUnpaid = money(Math.max(0, remaining - towardTarget));
  return {
    towardTarget,
    surplus,
    remainingUnpaid,
    splitApplied: true,
  };
}

/**
 * Apply a deposit amount against the member's monthly fixed target.
 * Returns split: towardTarget (savings), surplus (advance), and updated due.
 */
async function applyDepositToMonthlyDue({
  member,
  amount,
  yearMonth = yearMonthFromDate(),
  session = null,
} = {}) {
  const { sessionOpt } = require('./mongoTransaction');
  const total = money(amount);
  const target = await getTargetForMonth(yearMonth);

  if (target.amount == null) {
    return {
      yearMonth: target.yearMonth,
      targetAmount: null,
      towardTarget: total,
      surplus: 0,
      remainingUnpaid: 0,
      due: null,
      splitApplied: false,
    };
  }

  const due = await getOrCreateMemberDue(member, target.yearMonth, target.amount, { session });
  const remaining = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  const split = computeMonthlyDepositSplit(total, remaining, target.amount);

  due.paidAmount = money(money(due.paidAmount) + split.towardTarget);
  due.unpaidAmount = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  due.surplusToAdvance = money(money(due.surplusToAdvance) + split.surplus);
  due.status = dueStatus(due.expectedAmount, due.paidAmount);
  due.memberName = member.name || due.memberName;
  await due.save(sessionOpt(session));

  return {
    yearMonth: target.yearMonth,
    targetAmount: money(target.amount),
    towardTarget: split.towardTarget,
    surplus: split.surplus,
    remainingUnpaid: money(due.unpaidAmount),
    due,
    splitApplied: true,
    source: target.source,
  };
}

async function listUnpaidMonthlyDues({ yearMonth = null, status = null, includeAll = false } = {}) {
  const filter = {};
  if (yearMonth) filter.yearMonth = parseYearMonth(yearMonth).yearMonth;
  if (includeAll) {
    // Return every due row for the month (paid + unpaid) for deposit split previews.
  } else if (status) {
    filter.status = status;
  } else {
    filter.status = { $in: ['unpaid', 'partial'] };
    filter.unpaidAmount = { $gt: 0 };
  }

  const rows = await MonthlyContributionDue.find(filter)
    .populate('member', 'name email savings advanceBalance status')
    .sort({ yearMonth: -1, unpaidAmount: -1 });

  return rows.map((row) => ({
    id: row._id,
    yearMonth: row.yearMonth,
    member: row.member,
    memberId: row.member?._id || row.member,
    memberName: row.memberName || row.member?.name || '',
    expectedAmount: money(row.expectedAmount),
    paidAmount: money(row.paidAmount),
    unpaidAmount: money(row.unpaidAmount),
    surplusToAdvance: money(row.surplusToAdvance),
    status: row.status,
    borrowing: row.borrowing,
  }));
}

async function getActiveMonthTarget() {
  return getTargetForMonth(yearMonthFromDate());
}

/**
 * Inclusive list of YYYY-MM keys from start through end (chronological).
 */
function listYearMonthsInclusive(fromYearMonth, toYearMonth) {
  const from = parseYearMonth(fromYearMonth);
  const to = parseYearMonth(toYearMonth);
  if (
    from.year > to.year
    || (from.year === to.year && from.month > to.month)
  ) {
    return [];
  }

  const months = [];
  let y = from.year;
  let m = from.month;
  while (y < to.year || (y === to.year && m <= to.month)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * Ensure the member has due rows for every targeted month from membership
 * start through the as-of month, then return arrears + current-month totals.
 */
async function getMemberArrearsSummary(memberId, {
  asOfDate = new Date(),
  session = null,
  ensureMissingMonths = true,
} = {}) {
  const { bindSession } = require('./mongoTransaction');
  const member = await bindSession(
    User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } }),
    session
  );
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  const currentYearMonth = yearMonthFromDate(asOfDate);
  const startYearMonth = yearMonthFromDate(member.createdAt || asOfDate);
  const monthKeys = listYearMonthsInclusive(startYearMonth, currentYearMonth);

  if (ensureMissingMonths) {
    for (const key of monthKeys) {
      const target = await getTargetForMonth(key);
      if (target.amount == null) continue;
      await getOrCreateMemberDue(member, key, target.amount, { session });
    }
  }

  const dues = await bindSession(
    MonthlyContributionDue.find({
      member: member._id,
      yearMonth: { $gte: startYearMonth, $lte: currentYearMonth },
      status: { $in: ['unpaid', 'partial'] },
      unpaidAmount: { $gt: 0 },
    }).sort({ yearMonth: 1 }),
    session
  );

  const unpaidMonths = dues.map((row) => {
    const parsed = parseYearMonth(row.yearMonth);
    return {
      id: row._id,
      yearMonth: row.yearMonth,
      monthLabel: parsed.monthLabel,
      expectedAmount: money(row.expectedAmount),
      paidAmount: money(row.paidAmount),
      unpaidAmount: money(row.unpaidAmount),
      status: row.status,
      isCurrent: row.yearMonth === currentYearMonth,
    };
  });

  const previousMonths = unpaidMonths.filter((row) => !row.isCurrent);
  const currentMonth = unpaidMonths.find((row) => row.isCurrent) || null;
  const currentTarget = await getTargetForMonth(currentYearMonth);
  // After ensureMissingMonths, unpaid/partial rows are authoritative. Do not
  // invent a full current-month charge when the month is already paid (absent
  // from unpaidMonths) — that would inflate totalDue.
  const currentUnpaid = currentMonth ? money(currentMonth.unpaidAmount) : 0;
  const previousUnpaidTotal = money(
    previousMonths.reduce((sum, row) => sum + Number(row.unpaidAmount || 0), 0)
  );
  // Cash the member should hand to the cashier: prior unpaid + current remaining.
  const totalDue = money(previousUnpaidTotal + currentUnpaid);
  const previousMonthsCount = previousMonths.length;
  const monthlyRate = currentTarget.amount != null
    ? money(currentTarget.amount)
    : (previousMonths[0] ? money(previousMonths[0].expectedAmount) : 0);

  const currentDueRow = await bindSession(
    MonthlyContributionDue.findOne({
      member: member._id,
      yearMonth: currentYearMonth,
    }).select('paidAmount unpaidAmount expectedAmount status'),
    session
  ).lean();
  const currentMonthPaid = currentDueRow
    ? money(currentDueRow.paidAmount)
    : (currentMonth ? money(currentMonth.paidAmount) : 0);
  const currentMonthRequired = monthlyRate;
  // Explicit product formula for display: previous unpaid + current fixed target
  // (when current still has a balance). After full current payment, only arrears remain.
  const totalDueWithFullCurrentTarget = money(
    previousUnpaidTotal + (currentUnpaid > 0 ? currentMonthRequired : 0)
  );

  const { formatMoney } = require('./moneyFormat');
  const previousLabels = previousMonths.map((row) => row.monthLabel || row.yearMonth);
  let cashierMessage = '';
  let memberMessage = '';
  if (previousMonthsCount > 0) {
    cashierMessage = `This member has unpaid dues for ${previousMonthsCount} previous month(s)`
      + `${previousLabels.length ? ` (${previousLabels.join(', ')})` : ''}. `
      + `Total required deposit including current month: ${formatMoney(totalDue, 2)}.`;
    memberMessage = `You missed ${previousMonthsCount} previous month(s)`
      + `${previousLabels.length ? ` (${previousLabels.join(', ')})` : ''}. `
      + `Current month required: ${formatMoney(currentMonthRequired, 2)}. `
      + `Total due: ${formatMoney(totalDue, 2)}. `
      + 'Please coordinate with the cashier to clear the oldest months first.';
  } else if (currentUnpaid > 0) {
    cashierMessage = `Current month (${currentTarget.monthLabel || currentYearMonth}) remaining due: `
      + `${formatMoney(currentUnpaid, 2)}.`;
    memberMessage = `${currentTarget.monthLabel || currentYearMonth} deposit still due: `
      + `${formatMoney(currentUnpaid, 2)}.`;
  }

  return {
    memberId: member._id,
    memberName: member.name || '',
    startYearMonth,
    currentYearMonth,
    currentMonthLabel: currentTarget.monthLabel || currentYearMonth,
    monthlyRate,
    currentMonthRequired,
    currentMonthPaid,
    previousMonthsCount,
    previousUnpaidCount: previousMonthsCount,
    previousMonths,
    previousUnpaidTotal,
    currentMonthUnpaid: currentUnpaid,
    currentMonth,
    totalDue,
    totalDueWithFullCurrentTarget,
    unpaidMonths,
    hasArrears: previousMonthsCount > 0,
    hasBalanceDue: totalDue > 0,
    cashierMessage,
    memberMessage,
    memberDashboard: {
      monthLabel: currentTarget.monthLabel || currentYearMonth,
      yearMonth: currentYearMonth,
      currentMonthRequired,
      currentMonthPaid,
      currentMonthUnpaid: currentUnpaid,
      previousMonthsCount,
      previousUnpaidTotal,
      previousMonthLabels: previousLabels,
      totalDue,
      status: totalDue <= 0
        ? 'paid'
        : (previousMonthsCount > 0 ? 'arrears' : (currentUnpaid > 0 ? 'current_due' : 'paid')),
      tip: previousMonthsCount > 0
        ? 'Hand this total to the cashier. Oldest unpaid months are cleared first.'
        : (currentUnpaid > 0
          ? 'Pay the cashier this month’s remaining fixed deposit (deadline 15th; auto-deduct from Advance if funded).'
          : 'Your monthly fixed deposit is up to date.'),
    },
  };
}

/**
 * Build a 12-month plan for a calendar year (configured + env fallback hints).
 */
async function listTargetsForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    const error = new Error('Year must be between 2000 and 2100.');
    error.status = 400;
    throw error;
  }

  const prefix = `${y}-`;
  const configured = await MonthlyContributionTarget.find({
    yearMonth: { $regex: `^${prefix}` },
  }).lean();
  const byMonth = new Map(configured.map((row) => [row.yearMonth, row]));
  const envFallback = getMonthlyContributionAmount();

  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const yearMonth = `${y}-${String(m).padStart(2, '0')}`;
    const { monthLabel } = parseYearMonth(yearMonth);
    const doc = byMonth.get(yearMonth);
    if (doc) {
      months.push({
        yearMonth,
        monthLabel,
        amount: money(doc.amount),
        notes: doc.notes || '',
        setBy: doc.setBy || '',
        setAt: doc.setAt || doc.updatedAt,
        configured: true,
        source: 'configured',
      });
    } else {
      months.push({
        yearMonth,
        monthLabel,
        amount: envFallback != null ? money(envFallback) : null,
        notes: envFallback != null ? 'Env fallback (not saved)' : '',
        setBy: '',
        setAt: null,
        configured: false,
        source: envFallback != null ? 'env_fallback' : 'none',
      });
    }
  }

  return { year: y, months };
}

/**
 * Bulk upsert month targets for a calendar year.
 * `months` is an array of { yearMonth, amount, notes? } or { month, amount }.
 */
async function bulkUpsertTargets({
  year,
  months = [],
  setBy = 'Admin',
  syncDues = true,
} = {}) {
  const y = Number(year);
  if (!Number.isFinite(y)) {
    const error = new Error('Year is required.');
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(months) || !months.length) {
    const error = new Error('Provide at least one month amount.');
    error.status = 400;
    throw error;
  }

  const saved = [];
  for (const row of months) {
    const yearMonth = row.yearMonth
      || `${y}-${String(Number(row.month)).padStart(2, '0')}`;
    if (row.amount === '' || row.amount === null || row.amount === undefined) {
      continue;
    }
    const result = await upsertTarget({
      yearMonth,
      amount: row.amount,
      notes: row.notes || '',
      setBy,
      syncDues,
    });
    saved.push(result.target);
  }

  return {
    year: y,
    saved,
    count: saved.length,
  };
}

module.exports = {
  money,
  yearMonthFromDate,
  parseYearMonth,
  getTargetForMonth,
  getActiveMonthTarget,
  listTargets,
  listTargetsForYear,
  bulkUpsertTargets,
  upsertTarget,
  syncMonthDues,
  getOrCreateMemberDue,
  computeMonthlyDepositSplit,
  applyDepositToMonthlyDue,
  listUnpaidMonthlyDues,
  listYearMonthsInclusive,
  getMemberArrearsSummary,
  dueStatus,
};
