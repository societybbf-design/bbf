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

async function getOrCreateMemberDue(member, yearMonth, expectedAmount) {
  const { yearMonth: key } = parseYearMonth(yearMonth);
  const expected = money(expectedAmount);
  let due = await MonthlyContributionDue.findOne({ member: member._id, yearMonth: key });

  if (!due) {
    due = await MonthlyContributionDue.create({
      member: member._id,
      memberName: member.name || '',
      yearMonth: key,
      expectedAmount: expected,
      paidAmount: 0,
      unpaidAmount: expected,
      surplusToAdvance: 0,
      status: dueStatus(expected, 0),
    });
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
    await due.save();
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
 * Apply a deposit amount against the member's monthly fixed target.
 * Returns split: towardTarget (savings), surplus (advance), and updated due.
 */
async function applyDepositToMonthlyDue({
  member,
  amount,
  yearMonth = yearMonthFromDate(),
} = {}) {
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

  const due = await getOrCreateMemberDue(member, target.yearMonth, target.amount);
  const remaining = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  const towardTarget = money(Math.min(total, remaining));
  const surplus = money(Math.max(0, total - towardTarget));

  due.paidAmount = money(money(due.paidAmount) + towardTarget);
  due.unpaidAmount = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  due.surplusToAdvance = money(money(due.surplusToAdvance) + surplus);
  due.status = dueStatus(due.expectedAmount, due.paidAmount);
  due.memberName = member.name || due.memberName;
  await due.save();

  return {
    yearMonth: target.yearMonth,
    targetAmount: money(target.amount),
    towardTarget,
    surplus,
    remainingUnpaid: money(due.unpaidAmount),
    due,
    splitApplied: true,
    source: target.source,
  };
}

async function listUnpaidMonthlyDues({ yearMonth = null, status = null } = {}) {
  const filter = {};
  if (yearMonth) filter.yearMonth = parseYearMonth(yearMonth).yearMonth;
  if (status) {
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

module.exports = {
  money,
  yearMonthFromDate,
  parseYearMonth,
  getTargetForMonth,
  getActiveMonthTarget,
  listTargets,
  upsertTarget,
  syncMonthDues,
  getOrCreateMemberDue,
  applyDepositToMonthlyDue,
  listUnpaidMonthlyDues,
  dueStatus,
};
