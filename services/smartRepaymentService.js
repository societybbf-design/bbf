'use strict';

const User = require('../models/User');
const InternalBorrowing = require('../models/InternalBorrowing');
const InvestmentContribution = require('../models/InvestmentContribution');
const { formatMoney } = require('./moneyFormat');
const {
  money,
  yearMonthFromDate,
  getTargetForMonth,
  getOrCreateMemberDue,
  computeMonthlyDepositSplit,
} = require('./monthlyTargetService');
const { contributionRemainingDue } = require('./advanceBorrowingService');
const { getMemberOutstandingSummary } = require('./loanRepaymentService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Collect open liabilities for smart payment allocation (priority order).
 */
async function getMemberPaymentLiabilities(memberId, {
  yearMonth = yearMonthFromDate(),
} = {}) {
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) throw httpError('Member not found.', 404);

  const [projectBorrowings, contributions, loanSummary, target] = await Promise.all([
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
    getMemberOutstandingSummary(memberId),
    getTargetForMonth(yearMonth),
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

  let monthlyDue = 0;
  if (target.amount != null) {
    const due = await getOrCreateMemberDue(member, yearMonth, target.amount);
    monthlyDue = money(Math.max(0, money(due.expectedAmount) - money(due.paidAmount)));
  }

  const loanDue = loanSummary.hasOutstandingLoan ? money(loanSummary.availableToPay || 0) : 0;

  return {
    member: {
      id: member._id,
      name: member.name,
      savings: money(member.savings),
      advanceBalance: money(member.advanceBalance),
    },
    yearMonth,
    target,
    legs: {
      internalBorrowings: borrowingRows,
      unpaidContributions: contributionRows,
      loan: loanSummary.hasOutstandingLoan ? {
        outstanding: loanDue,
        fundingReserveOutstanding: money(loanSummary.fundingReserveOutstanding || 0),
        openBorrowings: loanSummary.openBorrowings || [],
        loanId: loanSummary.loan?._id,
      } : null,
      monthlyDeposit: monthlyDue > 0 ? {
        outstanding: monthlyDue,
        targetAmount: money(target.amount),
      } : null,
    },
    totalOutstanding: money(
      borrowingRows.reduce((s, r) => s + r.outstanding, 0)
      + contributionRows.reduce((s, r) => s + r.outstanding, 0)
      + loanDue
      + monthlyDue
    ),
  };
}

/**
 * Pure allocation plan for a cashier payment across liabilities.
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

  if (liabilities.legs.loan && remaining > 0) {
    const loanMax = money(liabilities.legs.loan.outstanding);
    if (loanMax > 0) {
      push({
        kind: 'loan_repayment',
        loanId: liabilities.legs.loan.loanId,
        label: 'Loan repayment',
        amount: Math.min(remaining, loanMax),
        max: loanMax,
      });
    }
  }

  if (liabilities.legs.monthlyDeposit && remaining > 0) {
    const monthlyMax = money(liabilities.legs.monthlyDeposit.outstanding);
    if (monthlyMax > 0) {
      push({
        kind: 'monthly_deposit',
        yearMonth: liabilities.yearMonth,
        label: `Monthly deposit ${liabilities.yearMonth}`,
        amount: Math.min(remaining, monthlyMax),
        max: monthlyMax,
      });
    }
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
      toLoan: money(allocations.filter((a) => a.kind === 'loan_repayment').reduce((s, a) => s + a.amount, 0)),
      toMonthly: money(allocations.filter((a) => a.kind === 'monthly_deposit').reduce((s, a) => s + a.amount, 0)),
      toAdvance: money(allocations.filter((a) => a.kind === 'advance_surplus').reduce((s, a) => s + a.amount, 0)),
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
 * Apply a single cashier payment across borrowings, project dues, loan, monthly target, and advance.
 * Credits the bank ledger once for the full cash amount.
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

  const { liabilities, plan } = await previewSmartMemberPayment({ memberId, amount: total, yearMonth });
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) throw httpError('Member not found.', 404);
  if (member.status !== 'active') throw httpError('Only active members can receive payments.', 400);

  const { settleInternalBorrowing } = require('./advanceBorrowingService');
  const { repayUnpaidContribution } = require('./advanceBorrowingService');
  const { recordAdminLoanRepayment } = require('./loanRepaymentService');
  const { saveDeposit } = require('./memberService');
  const { saveAdvanceDeposit } = require('./advanceBorrowingService');
  const { creditInbound } = require('./bankLedgerService');

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
      });
      applied.push({ ...leg, result: settled });
    } else if (leg.kind === 'unpaid_contribution') {
      const repaid = await repayUnpaidContribution(leg.contributionId, {
        amount: leg.amount,
        recordedBy,
        notes: notes || `Smart payment — project share`,
        skipBankCredit: true,
      });
      applied.push({ ...leg, result: repaid });
    } else if (leg.kind === 'loan_repayment') {
      const loanRepay = await recordAdminLoanRepayment({
        memberId,
        amount: leg.amount,
        repaymentType: 'partial',
        paymentMethod,
        adminNote: notes || 'Smart payment — loan leg',
        reviewedBy: recordedBy,
        skipBankCredit: true,
      });
      applied.push({ ...leg, result: loanRepay });
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
      });
      applied.push({ ...leg, result: monthlyResult });
    } else if (leg.kind === 'advance_surplus') {
      advanceResult = await saveAdvanceDeposit(memberId, leg.amount, {
        notes: notes || 'Smart payment — surplus to advance balance',
        recordedBy,
        skipBankCredit: true,
      });
      applied.push({ ...leg, result: advanceResult });
    }
  }

  let bankLedger = null;
  try {
    bankLedger = await creditInbound({
      type: 'deposit',
      amount: total,
      referenceType: 'SmartMemberPayment',
      referenceId: memberId,
      note: `Smart cashier payment from ${member.name} · ${plan.allocations.map((a) => `${a.label} ${formatMoney(a.amount, 2)}`).join(' · ')}`,
      createdBy: recordedBy,
      paymentChannel: paymentMethod,
    });
  } catch (error) {
    const { tryCredit } = require('./bankLedgerService');
    bankLedger = await tryCredit({
      type: 'deposit',
      amount: total,
      referenceType: 'SmartMemberPayment',
      referenceId: memberId,
      note: `Smart cashier payment from ${member.name}`,
      createdBy: recordedBy,
    });
    if (!bankLedger) {
      console.warn('[smartRepayment] bank ledger credit skipped:', error.message);
    }
  }

  const refreshedMember = await User.findById(memberId);
  const messageParts = [];
  if (plan.summary.toLenders > 0) {
    messageParts.push(`refunded lenders ${formatMoney(plan.summary.toLenders, 2)}`);
  }
  if (plan.summary.toProjectDues > 0) {
    messageParts.push(`project dues ${formatMoney(plan.summary.toProjectDues, 2)}`);
  }
  if (plan.summary.toLoan > 0) {
    messageParts.push(`loan ${formatMoney(plan.summary.toLoan, 2)}`);
  }
  if (plan.summary.toMonthly > 0) {
    messageParts.push(`monthly deposit ${formatMoney(plan.summary.toMonthly, 2)}`);
  }
  if (plan.summary.toAdvance > 0) {
    messageParts.push(`advance surplus ${formatMoney(plan.summary.toAdvance, 2)}`);
  }

  return {
    member: refreshedMember,
    plan,
    applied,
    monthlyResult,
    advanceResult,
    bankLedger,
    bookBalance: bankLedger?.ledger?.bookBalance ?? null,
    message: messageParts.length
      ? `Smart payment recorded: ${messageParts.join(' · ')}.`
      : 'Smart payment recorded.',
  };
}

module.exports = {
  money,
  getMemberPaymentLiabilities,
  buildSmartPaymentPlan,
  previewSmartMemberPayment,
  applySmartMemberPayment,
};
