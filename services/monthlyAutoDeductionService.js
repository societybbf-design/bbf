'use strict';

const User = require('../models/User');
const Deposit = require('../models/Deposit');
const {
  money,
  yearMonthFromDate,
  getTargetForMonth,
  getOrCreateMemberDue,
  applyDepositToMonthlyDue,
  syncMonthDues,
} = require('./monthlyTargetService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { formatMoney } = require('./moneyFormat');

const AUTO_RECORDED_BY = 'System (auto-advance)';
const DEDUCTION_WINDOW_END_DAY = 15;

function isWithinAutoDeductionWindow(date = new Date()) {
  const day = date.getDate();
  return day >= 1 && day <= DEDUCTION_WINDOW_END_DAY;
}

async function memberHasAutoDeductionThisMonth(memberId, yearMonth) {
  const existing = await Deposit.findOne({
    member: memberId,
    yearMonth,
    type: 'regular',
    recordedBy: AUTO_RECORDED_BY,
  }).select('_id').lean();
  return Boolean(existing);
}

/**
 * Deduct remaining monthly due from member advance balance (no external cash / bank credit).
 */
async function deductMonthlyFromAdvance(member, {
  yearMonth = yearMonthFromDate(),
  asOf = new Date(),
} = {}) {
  const target = await getTargetForMonth(yearMonth);
  if (target.amount == null || !(target.amount > 0)) {
    return { skipped: true, reason: 'no_target' };
  }

  await syncMonthDues(yearMonth, { expectedAmount: target.amount });
  const due = await getOrCreateMemberDue(member, yearMonth, target.amount);
  const remaining = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  if (!(remaining > 0)) {
    return { skipped: true, reason: 'already_paid' };
  }

  if (await memberHasAutoDeductionThisMonth(member._id, yearMonth)) {
    return { skipped: true, reason: 'already_auto_deducted' };
  }

  const freshMember = await User.findById(member._id);
  if (!freshMember || freshMember.status !== 'active') {
    return { skipped: true, reason: 'inactive_member' };
  }

  const advanceAvailable = money(freshMember.advanceBalance);
  if (advanceAvailable + 0.001 < remaining) {
    return {
      skipped: true,
      reason: 'insufficient_advance',
      remainingDue: remaining,
      advanceAvailable,
    };
  }

  const split = await applyDepositToMonthlyDue({
    member: freshMember,
    amount: remaining,
    yearMonth,
  });

  const towardTarget = money(split.towardTarget);
  if (!(towardTarget > 0)) {
    return { skipped: true, reason: 'nothing_to_apply' };
  }

  freshMember.advanceBalance = money(advanceAvailable - towardTarget);
  freshMember.savings = money(Number(freshMember.savings || 0) + towardTarget);
  await freshMember.save();

  const deposit = await Deposit.create({
    member: freshMember._id,
    amount: towardTarget,
    type: 'regular',
    yearMonth,
    towardTarget,
    surplusToAdvance: 0,
    notes: `Auto monthly deduction from advance balance (deadline ${DEDUCTION_WINDOW_END_DAY}th)`,
    recordedBy: AUTO_RECORDED_BY,
    paymentMethod: 'cash',
  });

  if (split.due) {
    split.due.autoDeductedAt = asOf;
    await split.due.save();
  }

  const message = `Your ${target.monthLabel || yearMonth} monthly deposit of ${formatMoney(towardTarget, 2)} `
    + `was automatically deducted from your Advance Balance before the ${DEDUCTION_WINDOW_END_DAY}th deadline. `
    + `Advance balance is now ${formatMoney(freshMember.advanceBalance, 2)}.`;

  await createMemberNotification({
    memberId: freshMember._id,
    type: 'deposit',
    title: 'Monthly deposit auto-deducted',
    message,
    relatedId: deposit._id,
    relatedModel: 'Deposit',
    link: 'portfolio',
  }).catch(() => null);

  await notifyMemberByEmailAndSms(freshMember, {
    subject: 'Monthly deposit auto-deducted from advance',
    message: `Dear ${freshMember.name}, ${message}`,
  }).catch(() => null);

  return {
    applied: true,
    memberId: freshMember._id,
    memberName: freshMember.name,
    yearMonth,
    amount: towardTarget,
    deposit,
    advanceBalanceAfter: freshMember.advanceBalance,
    savingsAfter: freshMember.savings,
    remainingUnpaid: money(split.remainingUnpaid),
  };
}

/**
 * Run auto-deduction for all active members still unpaid between the 1st and 15th.
 */
async function runMonthlyAutoDeductions({ asOf = new Date(), dryRun = false } = {}) {
  if (!isWithinAutoDeductionWindow(asOf)) {
    return {
      skipped: true,
      reason: 'outside_window',
      window: `1-${DEDUCTION_WINDOW_END_DAY}`,
      day: asOf.getDate(),
    };
  }

  const yearMonth = yearMonthFromDate(asOf);
  const target = await getTargetForMonth(yearMonth);
  if (target.amount == null) {
    return { skipped: true, reason: 'no_target', yearMonth };
  }

  await syncMonthDues(yearMonth, { expectedAmount: target.amount });
  const members = await User.find({ role: 'member', status: 'active' }).select('name email advanceBalance savings');
  const results = [];

  for (const member of members) {
    if (dryRun) {
      const due = await getOrCreateMemberDue(member, yearMonth, target.amount);
      const remaining = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
      results.push({
        memberId: member._id,
        memberName: member.name,
        remainingDue: remaining,
        advanceBalance: money(member.advanceBalance),
        wouldDeduct: remaining > 0 && money(member.advanceBalance) >= remaining,
        dryRun: true,
      });
      continue;
    }

    try {
      const outcome = await deductMonthlyFromAdvance(member, { yearMonth, asOf });
      results.push({ memberId: member._id, memberName: member.name, ...outcome });
    } catch (error) {
      results.push({
        memberId: member._id,
        memberName: member.name,
        error: error.message,
      });
    }
  }

  return {
    yearMonth,
    targetAmount: target.amount,
    day: asOf.getDate(),
    processed: results.length,
    applied: results.filter((row) => row.applied).length,
    results,
  };
}

module.exports = {
  AUTO_RECORDED_BY,
  DEDUCTION_WINDOW_END_DAY,
  isWithinAutoDeductionWindow,
  deductMonthlyFromAdvance,
  runMonthlyAutoDeductions,
};
