'use strict';

const User = require('../models/User');
const InternalBorrowing = require('../models/InternalBorrowing');
const InvestmentContribution = require('../models/InvestmentContribution');
const { formatMoney } = require('./moneyFormat');
const {
  money,
  yearMonthFromDate,
  getTargetForMonth,
  getMemberArrearsSummary,
} = require('./monthlyTargetService');
const { contributionRemainingDue } = require('./advanceBorrowingService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Collect open deposit-screen liabilities for smart payment allocation.
 * Formal member loans are excluded — those are handled only in the Loans module.
 * Priority: project/emergency internal dues → unpaid monthly months (oldest first)
 * → current month → advance surplus.
 */
async function getMemberPaymentLiabilities(memberId, {
  yearMonth = yearMonthFromDate(),
} = {}) {
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) throw httpError('Member not found.', 404);

  const [y, m] = String(yearMonth).split('-').map(Number);
  const asOfDate = Number.isFinite(y) && Number.isFinite(m)
    ? new Date(y, m - 1, 15)
    : new Date();

  const [projectBorrowings, contributions, arrears] = await Promise.all([
    // Project / emergency internal borrows only (exclude formal-loan funding borrows).
    InternalBorrowing.find({
      borrower: memberId,
      loan: null,
      status: { $in: ['open', 'partial'] },
    }).sort({ createdAt: 1 }).lean(),
    InvestmentContribution.find({
      member: memberId,
      $or: [
        { unpaidAmount: { $gt: 0 } },
        { status: 'unpaid' },
      ],
    }).populate('investment', 'investmentCode').sort({ createdAt: 1 }).lean(),
    getMemberArrearsSummary(memberId, { asOfDate }),
  ]);

  const borrowingRows = projectBorrowings.map((row) => ({
    id: row._id,
    kind: 'internal_borrowing',
    label: row.investment ? `Project borrow ${row.note || ''}`.trim() : (row.note || 'Internal borrow'),
    lenderName: row.lenderName || '',
    outstanding: money(Math.max(0, Number(row.amount || 0) - Number(row.amountSettled || 0))),
    borrowingId: row._id,
  })).filter((row) => row.outstanding > 0);

  const contributionRows = contributions
    .map((row) => {
      const due = contributionRemainingDue(row);
      if (!(due > 0)) return null;
      if (row.borrowing && row.status === 'covered_by_borrow' && money(row.unpaidAmount) <= 0) {
        return null;
      }
      return {
        id: row._id,
        kind: 'unpaid_contribution',
        label: `Project share ${row.investment?.investmentCode || ''}`.trim(),
        outstanding: money(due),
        contributionId: row._id,
      };
    })
    .filter(Boolean);

  // Oldest unpaid month first, including current month when still due.
  const monthlyDepositMonths = (arrears.unpaidMonths || []).map((row) => ({
    yearMonth: row.yearMonth,
    monthLabel: row.monthLabel,
    outstanding: money(row.unpaidAmount),
    expectedAmount: money(row.expectedAmount),
    isCurrent: Boolean(row.isCurrent),
    label: row.isCurrent
      ? `Monthly deposit ${row.yearMonth} (current)`
      : `Monthly arrears ${row.yearMonth}`,
  }));

  const monthlyDue = money(
    monthlyDepositMonths.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)
  );

  return {
    member: {
      id: member._id,
      name: member.name,
      savings: money(member.savings),
      advanceBalance: money(member.advanceBalance),
    },
    yearMonth,
    target: arrears.monthlyRate != null
      ? {
        yearMonth: arrears.currentYearMonth,
        monthLabel: arrears.currentMonthLabel,
        amount: arrears.monthlyRate,
      }
      : await getTargetForMonth(yearMonth),
    arrears,
    legs: {
      internalBorrowings: borrowingRows,
      unpaidContributions: contributionRows,
      monthlyDepositMonths,
      monthlyDeposit: monthlyDue > 0 ? {
        outstanding: monthlyDue,
        targetAmount: money(arrears.monthlyRate),
        previousMonthsCount: arrears.previousMonthsCount,
        currentMonthUnpaid: arrears.currentMonthUnpaid,
      } : null,
    },
    totalOutstanding: money(
      borrowingRows.reduce((s, r) => s + r.outstanding, 0)
      + contributionRows.reduce((s, r) => s + r.outstanding, 0)
      + monthlyDue
    ),
  };
}

/**
 * Pure allocation plan for a cashier deposit payment.
 * Formal loan repayments are never included.
 * Monthly dues clear oldest unpaid month first, then current, then surplus → advance.
 */
function buildSmartPaymentPlan(liabilities, totalAmount) {
  let remaining = money(totalAmount);
  const allocations = [];

  const push = (entry) => {
    if (!(entry.amount > 0)) return;
    allocations.push({ ...entry, amount: money(entry.amount) });
    remaining = money(remaining - entry.amount);
  };

  for (const row of liabilities.legs.internalBorrowings || []) {
    if (remaining <= 0) break;
    push({
      kind: 'internal_borrowing',
      borrowingId: row.borrowingId,
      label: row.label,
      lenderName: row.lenderName,
      amount: Math.min(remaining, row.outstanding),
      max: row.outstanding,
    });
  }

  for (const row of liabilities.legs.unpaidContributions || []) {
    if (remaining <= 0) break;
    push({
      kind: 'unpaid_contribution',
      contributionId: row.contributionId,
      label: row.label,
      amount: Math.min(remaining, row.outstanding),
      max: row.outstanding,
    });
  }

  const monthlyMonths = Array.isArray(liabilities.legs.monthlyDepositMonths)
    && liabilities.legs.monthlyDepositMonths.length
    ? liabilities.legs.monthlyDepositMonths
    : (liabilities.legs.monthlyDeposit
      ? [{
        yearMonth: liabilities.yearMonth,
        outstanding: liabilities.legs.monthlyDeposit.outstanding,
        label: `Monthly deposit ${liabilities.yearMonth}`,
        isCurrent: true,
      }]
      : []);

  for (const row of monthlyMonths) {
    if (remaining <= 0) break;
    const monthlyMax = money(row.outstanding);
    if (!(monthlyMax > 0)) continue;
    push({
      kind: 'monthly_deposit',
      yearMonth: row.yearMonth,
      label: row.label || `Monthly deposit ${row.yearMonth}`,
      amount: Math.min(remaining, monthlyMax),
      max: monthlyMax,
      isCurrent: Boolean(row.isCurrent),
    });
  }

  if (remaining > 0) {
    push({
      kind: 'advance_surplus',
      label: 'Advance balance (surplus)',
      amount: remaining,
      max: remaining,
    });
    remaining = 0;
  }

  return {
    totalAmount: money(totalAmount),
    allocations,
    unallocated: money(remaining),
    summary: {
      toLenders: money(allocations.filter((a) => a.kind === 'internal_borrowing').reduce((s, a) => s + a.amount, 0)),
      toProjectDues: money(allocations.filter((a) => a.kind === 'unpaid_contribution').reduce((s, a) => s + a.amount, 0)),
      toMonthly: money(allocations.filter((a) => a.kind === 'monthly_deposit').reduce((s, a) => s + a.amount, 0)),
      toAdvance: money(allocations.filter((a) => a.kind === 'advance_surplus').reduce((s, a) => s + a.amount, 0)),
      monthlyMonthsCleared: allocations
        .filter((a) => a.kind === 'monthly_deposit')
        .map((a) => a.yearMonth),
    },
  };
}

async function previewSmartMemberPayment({ memberId, amount, yearMonth = yearMonthFromDate() }) {
  const total = money(amount);
  if (!(total > 0)) throw httpError('Payment amount must be greater than zero.');
  const liabilities = await getMemberPaymentLiabilities(memberId, { yearMonth });
  const plan = buildSmartPaymentPlan(liabilities, total);
  return { liabilities, plan };
}

/**
 * Apply a single cashier deposit across project/emergency internal dues, monthly target, and advance.
 * Formal loan repayments are never applied here — use the Loans module.
 * Credits the bank ledger once for the full cash amount.
 *
 * All deposit / repay / settle / ledger writes run inside withMongoTransaction so a mid-loop
 * failure rolls back dues, savings, borrowings, deposits, and the bank book together.
 * On standalone MongoDB (no replica set), withMongoTransaction falls back to non-transactional
 * execution — same sequential path, without multi-document atomicity.
 */
async function applySmartMemberPayment({
  memberId,
  amount,
  yearMonth = yearMonthFromDate(),
  recordedBy = 'Cashier',
  notes = '',
  paymentMethod = 'cash',
  paymentReference = '',
  actor = null,
  ip = '',
} = {}) {
  const total = money(amount);
  if (!(total > 0)) throw httpError('Payment amount must be greater than zero.');

  const { plan } = await previewSmartMemberPayment({ memberId, amount: total, yearMonth });
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) throw httpError('Member not found.', 404);
  if (member.status !== 'active') throw httpError('Only active members can receive payments.', 400);

  const { settleInternalBorrowing, repayUnpaidContribution, saveAdvanceDeposit, notifyLenderAdvanceRefund } = require('./advanceBorrowingService');
  const { saveDeposit } = require('./memberService');
  const { creditInbound } = require('./bankLedgerService');
  const { withMongoTransaction, bindSession } = require('./mongoTransaction');

  const result = await withMongoTransaction(async (session) => {
    const memberInTxn = await bindSession(
      User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } }),
      session
    );
    if (!memberInTxn) throw httpError('Member not found.', 404);
    if (memberInTxn.status !== 'active') {
      throw httpError('Only active members can receive payments.', 400);
    }

    const applied = [];
    let monthlyResult = null;
    let advanceResult = null;

    for (const leg of plan.allocations) {
      if (leg.kind === 'internal_borrowing') {
        const settled = await settleInternalBorrowing(leg.borrowingId, {
          amount: leg.amount,
          recordedBy,
          notes: notes || `Smart payment — refund lender (${leg.lenderName || 'lender'})`,
          cashReceived: true,
          skipBankCredit: true,
          skipNotifications: true,
          session,
        });
        applied.push({ ...leg, result: settled });
      } else if (leg.kind === 'unpaid_contribution') {
        const repaid = await repayUnpaidContribution(leg.contributionId, {
          amount: leg.amount,
          recordedBy,
          notes: notes || `Smart payment — project share`,
          skipBankCredit: true,
          skipNotifications: true,
          session,
        });
        applied.push({ ...leg, result: repaid });
      } else if (leg.kind === 'monthly_deposit') {
        monthlyResult = await saveDeposit(memberId, leg.amount, {
          yearMonth: leg.yearMonth || yearMonth,
          notes: notes || `Smart payment — monthly deposit ${leg.yearMonth || yearMonth}`,
          recordedBy,
          paymentMethod,
          paymentReference,
          actor,
          ip,
          skipBankCredit: true,
          smartPaymentLeg: true,
          session,
        });
        applied.push({ ...leg, result: monthlyResult });
      } else if (leg.kind === 'advance_surplus') {
        advanceResult = await saveAdvanceDeposit(memberId, leg.amount, {
          notes: notes || 'Smart payment — surplus to advance balance',
          recordedBy,
          skipBankCredit: true,
          session,
        });
        applied.push({ ...leg, result: advanceResult });
      }
    }

    // Single society bank credit for the full cashier cash amount (same session / rollback unit).
    const bankLedger = await creditInbound({
      type: 'deposit',
      amount: total,
      referenceType: 'SmartMemberPayment',
      referenceId: memberId,
      note: `Smart cashier payment from ${memberInTxn.name} · ${plan.allocations.map((a) => `${a.label} ${formatMoney(a.amount, 2)}`).join(' · ')}`,
      createdBy: recordedBy,
      paymentChannel: paymentMethod,
      paymentReference,
      session,
    });

    const refreshedMember = await bindSession(User.findById(memberId), session);
    return {
      member: refreshedMember,
      plan,
      applied,
      monthlyResult,
      advanceResult,
      bankLedger,
      bookBalance: bankLedger?.ledger?.bookBalance ?? null,
    };
  });

  // Post-commit side effects (must not run inside the transaction).
  for (const item of result.applied || []) {
    if (item.kind !== 'internal_borrowing' || !item.result?.notifyLender) continue;
    const settled = item.result;
    try {
      const lenderDoc = settled.lender?.id
        ? await User.findById(settled.lender.id).select('name email phone')
        : null;
      await notifyLenderAdvanceRefund({
        lender: lenderDoc || { _id: settled.lender?.id, name: settled.lender?.name },
        borrower: {
          _id: settled.borrower?.id,
          name: settled.borrower?.name,
        },
        payAmount: settled.settledAmount,
        fundingLabel: settled.fundingLabel,
        borrowingId: settled.borrowing?._id,
        lenderAdvanceAfter: settled.lender?.advanceBalance,
      });
    } catch (error) {
      console.warn('[smartRepayment] lender refund notification failed:', error.message);
    }
  }

  const messageParts = [];
  if (plan.summary.toLenders > 0) {
    messageParts.push(`refunded lenders ${formatMoney(plan.summary.toLenders, 2)}`);
  }
  if (plan.summary.toProjectDues > 0) {
    messageParts.push(`project dues ${formatMoney(plan.summary.toProjectDues, 2)}`);
  }
  if (plan.summary.toMonthly > 0) {
    messageParts.push(`monthly deposit ${formatMoney(plan.summary.toMonthly, 2)}`);
  }
  if (plan.summary.toAdvance > 0) {
    messageParts.push(`advance surplus ${formatMoney(plan.summary.toAdvance, 2)}`);
  }

  return {
    ...result,
    message: messageParts.length
      ? `Smart payment recorded: ${messageParts.join(' · ')}.`
      : 'Smart payment recorded.',
    transactional: true,
  };
}

module.exports = {
  money,
  getMemberPaymentLiabilities,
  buildSmartPaymentPlan,
  previewSmartMemberPayment,
  applySmartMemberPayment,
};
