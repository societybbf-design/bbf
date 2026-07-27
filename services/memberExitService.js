const { formatMoney } = require('./moneyFormat');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const MemberExitRequest = require('../models/MemberExitRequest');
const { removeMember } = require('./memberLifecycleService');
const { createMemberNotification } = require('./memberNotificationService');
const { createAdminNotification } = require('./adminNotificationService');
const { money, amountsMatch, listActiveSocietyMembers, getEntryValuation } = require('./memberMigrationService');

const OPEN_EXIT_STATUSES = [
  'pending_departing_approval',
  'pending_member_approval',
  'pending_cashier_payment',
];

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function assertNoBlockingLoans(memberId) {
  const LoanApplication = require('../models/LoanApplication');
  const blockingLoans = await LoanApplication.find({
    member: memberId,
    status: { $in: ['pending', 'approved', 'disbursed'] },
  }).select('status amount outstandingBalance repaymentStatus');

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
    throw httpError(
      'Cannot start member exit while the member has pending, approved, or outstanding loans. Clear loans first.'
    );
  }
}

function buildRedistributionPlan(remainingMembers, breakdown) {
  const savingsPool = money(breakdown.savings);
  const profitPool = money(breakdown.profit);
  const advancePool = money(breakdown.advance);
  const weights = remainingMembers.map((m) => ({
    member: m,
    weight: Math.max(0, Number(m.savings || 0)),
  }));
  const weightSum = weights.reduce((sum, row) => sum + row.weight, 0);
  const useEqual = weightSum <= 0.009 || remainingMembers.length === 0;

  const plan = [];
  let allocatedSavings = 0;
  let allocatedProfit = 0;
  let allocatedAdvance = 0;

  remainingMembers.forEach((member, index) => {
    const isLast = index === remainingMembers.length - 1;
    const weight = useEqual ? 1 : weights[index].weight;
    const base = useEqual ? remainingMembers.length : weightSum;
    const ratio = base > 0 ? weight / base : 0;

    let savingsCredit;
    let profitCredit;
    let advanceCredit;
    if (isLast) {
      savingsCredit = money(savingsPool - allocatedSavings);
      profitCredit = money(profitPool - allocatedProfit);
      advanceCredit = money(advancePool - allocatedAdvance);
    } else {
      savingsCredit = money(savingsPool * ratio);
      profitCredit = money(profitPool * ratio);
      advanceCredit = money(advancePool * ratio);
      allocatedSavings = money(allocatedSavings + savingsCredit);
      allocatedProfit = money(allocatedProfit + profitCredit);
      allocatedAdvance = money(allocatedAdvance + advanceCredit);
    }

    plan.push({
      member: member._id,
      memberName: member.name || '',
      weight: useEqual ? money(1 / Math.max(remainingMembers.length, 1)) : money(ratio),
      savingsCredit,
      profitCredit,
      advanceCredit,
      totalCredit: money(savingsCredit + profitCredit + advanceCredit),
    });
  });

  return plan;
}

function buildApprovalTracking(exitRequest) {
  const eligible = (exitRequest.eligibleMembers || []).map((id) => String(id));
  const approvedIds = new Set(
    (exitRequest.memberApprovals || []).map((row) => String(row.member?._id || row.member))
  );
  return {
    departingApproved: Boolean(exitRequest.departingApproval?.approvedAt),
    departingApprovedAt: exitRequest.departingApproval?.approvedAt || null,
    approvedCount: approvedIds.size,
    totalMembers: eligible.length,
    pendingMemberIds: eligible.filter((id) => !approvedIds.has(id)),
    allMembersApproved: eligible.length > 0 && eligible.every((id) => approvedIds.has(id)),
  };
}

function serializeExitRequest(doc) {
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  plain.approvalTracking = buildApprovalTracking(plain);
  return plain;
}

async function previewMemberExit(memberId) {
  const valuation = await getEntryValuation({ replaceMemberId: memberId });
  const departing = valuation.departing;
  if (!departing) {
    throw httpError('Departing member not found or already removed.', 404);
  }

  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['active', 'inactive'] },
  }).select('-password');
  if (!member) {
    throw httpError('Member not found or already removed.', 404);
  }

  const remaining = (await listActiveSocietyMembers())
    .filter((m) => String(m._id) !== String(memberId));

  const breakdown = {
    savings: money(member.savings),
    profit: money(member.profit),
    advance: money(member.advanceBalance),
  };
  const settlementAmount = money(breakdown.savings + breakdown.profit + breakdown.advance);
  const redistributionPlan = buildRedistributionPlan(remaining, breakdown);

  return {
    valuation,
    departingMember: {
      id: member._id,
      name: member.name,
      email: member.email,
      status: member.status,
    },
    settlementAmount,
    settlementBreakdown: breakdown,
    remainingMemberCount: remaining.length,
    redistributionPlan,
    formula: 'Settlement = savings + profit + advance. Released balances redistribute to remaining members by savings weight (equal if all zero). Cashier pays settlement from society bank.',
  };
}

async function initiateMemberExit({
  memberId,
  notes = '',
  confirmSettlementAmount = null,
  initiatedBy = 'CEO',
}) {
  if (!memberId) {
    throw httpError('Member is required to initiate exit.');
  }

  const preview = await previewMemberExit(memberId);
  if (confirmSettlementAmount != null && confirmSettlementAmount !== ''
    && !amountsMatch(confirmSettlementAmount, preview.settlementAmount)) {
    throw httpError(
      `Confirm the exact settlement of ${formatMoney(preview.settlementAmount, 2)}. Received ${formatMoney(confirmSettlementAmount, 2)}.`
    );
  }

  const member = await User.findOne({
    _id: memberId,
    role: 'member',
    status: { $in: ['active', 'inactive'] },
  });
  if (!member) {
    throw httpError('Member not found or already removed.', 404);
  }
  if (member.pendingEntryBuyIn) {
    throw httpError('This member still has a pending buy-in and cannot exit.');
  }

  await assertNoBlockingLoans(memberId);

  const existing = await MemberExitRequest.findOne({
    departingMember: memberId,
    status: { $in: OPEN_EXIT_STATUSES },
  });
  if (existing) {
    throw httpError('An open exit request already exists for this member.', 409);
  }

  if (!preview.remainingMemberCount) {
    throw httpError(
      'At least one remaining active member is required for share redistribution. Use replacement exit if this is the last member.'
    );
  }

  const exitRequest = await MemberExitRequest.create({
    departingMember: member._id,
    departingMemberName: member.name,
    departingMemberEmail: member.email,
    status: 'pending_departing_approval',
    settlementAmount: preview.settlementAmount,
    settlementBreakdown: preview.settlementBreakdown,
    eligibleMembers: preview.redistributionPlan.map((row) => row.member),
    redistributionPlan: preview.redistributionPlan,
    notes: String(notes || '').trim(),
    initiatedBy: String(initiatedBy || 'CEO').trim(),
    initiatedAt: new Date(),
  });

  await createMemberNotification({
    memberId: member._id,
    type: 'general',
    title: 'Member Exit Approval Required',
    message: `CEO initiated your exit. Settlement ${formatMoney(preview.settlementAmount, 2)}. Please approve or reject this exit request.`,
    relatedId: exitRequest._id,
    relatedModel: 'MemberExitRequest',
  });

  await createAdminNotification({
    type: 'general',
    title: 'Member exit initiated — awaiting departing approval',
    message: `Exit for ${member.name} (${formatMoney(preview.settlementAmount, 2)}) is waiting for the departing member to approve.`,
    relatedId: exitRequest._id,
    relatedModel: 'MemberExitRequest',
  });

  return {
    exitRequest: serializeExitRequest(exitRequest),
    preview,
    message: 'Exit initiated. Waiting for the departing member to approve.',
  };
}

async function listOpenExitRequests() {
  const rows = await MemberExitRequest.find({
    status: { $in: OPEN_EXIT_STATUSES },
  })
    .populate('departingMember', 'name email status savings profit advanceBalance')
    .sort({ createdAt: -1 });
  return rows.map(serializeExitRequest);
}

async function listCashierExitQueue() {
  const rows = await MemberExitRequest.find({ status: 'pending_cashier_payment' })
    .populate('departingMember', 'name email phone status bankAccountName bankAccountNumber bankName')
    .sort({ updatedAt: 1 });
  return rows.map(serializeExitRequest);
}

async function getExitRequestById(id) {
  const doc = await MemberExitRequest.findById(id)
    .populate('departingMember', 'name email phone status savings profit advanceBalance')
    .populate('eligibleMembers', 'name email status');
  if (!doc) {
    throw httpError('Exit request not found.', 404);
  }
  return serializeExitRequest(doc);
}

async function listPendingExitRequestsForMember(memberId) {
  const open = await MemberExitRequest.find({
    status: { $in: OPEN_EXIT_STATUSES },
  })
    .populate('departingMember', 'name email')
    .sort({ createdAt: -1 });

  const relevant = open.filter((row) => {
    const departingId = String(row.departingMember?._id || row.departingMember);
    if (row.status === 'pending_departing_approval' && departingId === String(memberId)) {
      return true;
    }
    if (row.status === 'pending_member_approval') {
      const eligible = (row.eligibleMembers || []).map((id) => String(id));
      if (!eligible.includes(String(memberId))) return false;
      const already = (row.memberApprovals || []).some(
        (a) => String(a.member) === String(memberId)
      );
      return !already;
    }
    return false;
  });

  return relevant.map(serializeExitRequest);
}

async function approveExitByDepartingMember(exitRequestId, memberId) {
  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }
  if (exitRequest.status !== 'pending_departing_approval') {
    throw httpError('This exit is not waiting for departing-member approval.');
  }
  if (String(exitRequest.departingMember) !== String(memberId)) {
    throw httpError('Only the departing member can approve this step.', 403);
  }

  const member = await User.findById(memberId).select('name status role');
  if (!member || member.role !== 'member' || !['active', 'inactive'].includes(member.status)) {
    throw httpError('Member account required.', 403);
  }

  exitRequest.departingApproval = {
    member: member._id,
    memberName: member.name,
    approvedAt: new Date(),
  };
  exitRequest.status = 'pending_member_approval';
  await exitRequest.save();

  const eligibleIds = exitRequest.eligibleMembers || [];
  await Promise.all(eligibleIds.map((id) => createMemberNotification({
    memberId: id,
    type: 'general',
    title: 'Approve Member Exit Redistribution',
    message: `${exitRequest.departingMemberName} approved their exit. Settlement ${formatMoney(exitRequest.settlementAmount, 2)} will be paid by the Cashier after all members approve the share redistribution.`,
    relatedId: exitRequest._id,
    relatedModel: 'MemberExitRequest',
  })));

  await createAdminNotification({
    type: 'general',
    title: 'Departing member approved exit — member votes required',
    message: `${exitRequest.departingMemberName} approved exit. Waiting for ${eligibleIds.length} remaining member approval(s).`,
    relatedId: exitRequest._id,
    relatedModel: 'MemberExitRequest',
  });

  return {
    exitRequest: serializeExitRequest(exitRequest),
    message: 'Exit approved. Remaining members must now approve the redistribution.',
  };
}

async function rejectExitByDepartingMember(exitRequestId, memberId, reason = '') {
  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }
  if (exitRequest.status !== 'pending_departing_approval') {
    throw httpError('This exit is not waiting for departing-member approval.');
  }
  if (String(exitRequest.departingMember) !== String(memberId)) {
    throw httpError('Only the departing member can reject this step.', 403);
  }

  exitRequest.status = 'rejected';
  exitRequest.rejectedBy = 'departing_member';
  exitRequest.rejectionReason = String(reason || 'Rejected by departing member').trim();
  await exitRequest.save();

  await createAdminNotification({
    type: 'general',
    title: 'Member exit rejected by departing member',
    message: `${exitRequest.departingMemberName} rejected the exit request.`,
    relatedId: exitRequest._id,
    relatedModel: 'MemberExitRequest',
  });

  return {
    exitRequest: serializeExitRequest(exitRequest),
    message: 'Exit request rejected.',
  };
}

async function approveExitByMember(exitRequestId, memberId) {
  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }
  if (exitRequest.status !== 'pending_member_approval') {
    throw httpError('This exit is not waiting for remaining-member approvals.');
  }

  const eligible = (exitRequest.eligibleMembers || []).map((id) => String(id));
  if (!eligible.includes(String(memberId))) {
    throw httpError('You are not eligible to approve this exit redistribution.', 403);
  }

  const already = (exitRequest.memberApprovals || []).some(
    (row) => String(row.member) === String(memberId)
  );
  if (already) {
    return {
      exitRequest: serializeExitRequest(exitRequest),
      message: 'You already approved this exit redistribution.',
      alreadyApproved: true,
    };
  }

  const member = await User.findById(memberId).select('name status role');
  if (!member || member.role !== 'member' || member.status !== 'active') {
    throw httpError('Active member account required.', 403);
  }

  exitRequest.memberApprovals.push({
    member: member._id,
    memberName: member.name,
    approvedAt: new Date(),
  });

  const tracking = buildApprovalTracking(exitRequest);
  let message = `Approval recorded (${tracking.approvedCount}/${tracking.totalMembers}).`;

  if (tracking.allMembersApproved) {
    exitRequest.status = 'pending_cashier_payment';
    message = 'All members approved. Exit forwarded to the Cashier for payout.';
    await createAdminNotification({
      type: 'general',
      title: 'Member exit ready for Cashier payout',
      message: `Exit for ${exitRequest.departingMemberName} (${formatMoney(exitRequest.settlementAmount, 2)}) is ready for Cashier disbursement.`,
      relatedId: exitRequest._id,
      relatedModel: 'MemberExitRequest',
    });
  }

  await exitRequest.save();
  return {
    exitRequest: serializeExitRequest(exitRequest),
    message,
  };
}

async function cancelMemberExit(exitRequestId, { cancelledBy = 'CEO', reason = '' } = {}) {
  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }
  if (!OPEN_EXIT_STATUSES.includes(exitRequest.status)) {
    throw httpError('Only open exit requests can be cancelled.');
  }
  if (exitRequest.status === 'pending_cashier_payment') {
    throw httpError('This exit is already with the Cashier and cannot be cancelled from CEO panel.');
  }

  exitRequest.status = 'cancelled';
  exitRequest.rejectedBy = String(cancelledBy || 'CEO').trim();
  exitRequest.rejectionReason = String(reason || 'Cancelled by CEO').trim();
  await exitRequest.save();

  return {
    exitRequest: serializeExitRequest(exitRequest),
    message: 'Exit request cancelled.',
  };
}

async function completeCashierMemberExit(exitRequestId, {
  paymentMethod = '',
  transferReference = '',
  cashierNote = '',
  processedBy = 'Cashier',
} = {}) {
  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }
  if (exitRequest.status !== 'pending_cashier_payment') {
    throw httpError('Only fully approved exits can be paid by the Cashier.');
  }

  const member = await User.findOne({
    _id: exitRequest.departingMember,
    role: 'member',
    status: { $in: ['active', 'inactive'] },
  });
  if (!member) {
    throw httpError('Departing member not found or already removed.', 404);
  }

  await assertNoBlockingLoans(member._id);

  const settlement = money(exitRequest.settlementAmount);
  const { debit, getLedger, credit } = require('./bankLedgerService');

  let bookBalance = 0;
  try {
    const ledgerSummary = await getLedger({ entryLimit: 1 });
    bookBalance = money(ledgerSummary?.bookBalance);
  } catch (_) {
    // debit() will throw if opening/balance blocks payout
  }
  if (settlement > 0 && bookBalance + 0.001 < settlement) {
    throw httpError(
      `Society bank cash is insufficient for this exit. Settlement ${formatMoney(settlement, 2)}; book balance ${formatMoney(bookBalance, 2)}.`
    );
  }

  let exitDeposit = null;
  let bankDebit = null;

  if (settlement > 0) {
    exitDeposit = await Deposit.create({
      member: member._id,
      amount: settlement,
      type: 'exit_settlement',
      notes: cashierNote?.trim()
        || `Approved member-exit payout for ${member.name} (multi-approval workflow)`,
      recordedBy: String(processedBy || 'Cashier').trim(),
    });

    try {
      bankDebit = await debit({
        type: 'project_payout',
        amount: settlement,
        referenceType: 'Deposit',
        referenceId: exitDeposit._id,
        note: `Member-exit payout to ${member.name}`,
        createdBy: processedBy,
        paymentChannel: paymentMethod || '',
        paymentReference: transferReference || '',
      });
    } catch (err) {
      await Deposit.deleteOne({ _id: exitDeposit._id }).catch(() => {});
      throw err;
    }
  }

  try {
    for (const row of exitRequest.redistributionPlan || []) {
      if (!row.member) continue;
      const credits = {
        savings: money(row.savingsCredit),
        profit: money(row.profitCredit),
        advance: money(row.advanceCredit),
      };
      if (credits.savings <= 0 && credits.profit <= 0 && credits.advance <= 0) continue;

      await User.updateOne(
        { _id: row.member, role: 'member', status: 'active' },
        {
          $inc: {
            savings: credits.savings,
            profit: credits.profit,
            advanceBalance: credits.advance,
          },
        }
      );
    }

    member.exitSettledAt = new Date();
    member.exitSettlementAmount = settlement;
    member.exitSettledBy = String(processedBy || 'Cashier').trim();
    member.exitSettlementSource = 'approved_exit';
    member.savings = 0;
    member.profit = 0;
    member.advanceBalance = 0;
    await member.save();

    const removed = await removeMember(member._id, {
      reason: exitRequest.notes?.trim()
        || `Multi-approval exit completed; settlement ${formatMoney(settlement, 2)} paid by Cashier`,
      deletedBy: processedBy,
    });

    exitRequest.status = 'completed';
    exitRequest.cashierNote = String(cashierNote || '').trim();
    exitRequest.cashierProcessedBy = String(processedBy || 'Cashier').trim();
    exitRequest.cashierProcessedAt = new Date();
    exitRequest.paymentMethod = String(paymentMethod || '').trim();
    exitRequest.transferReference = String(transferReference || '').trim();
    exitRequest.exitDepositId = exitDeposit?._id || null;
    exitRequest.bankLedgerEntryId = bankDebit?.entry?._id || null;
    await exitRequest.save();

    await createAdminNotification({
      type: 'general',
      title: 'Member exit payout completed',
      message: `Cashier completed exit payout for ${removed.name || member.name}: ${formatMoney(settlement, 2)}. Shares redistributed to remaining members.`,
      relatedId: exitRequest._id,
      relatedModel: 'MemberExitRequest',
    });

    return {
      exitRequest: serializeExitRequest(exitRequest),
      departingMember: removed,
      bankLedger: {
        debit: bankDebit,
        bookBalanceAfter: bankDebit?.ledger?.bookBalance ?? money(bookBalance - settlement),
      },
      message: settlement > 0
        ? `Exit completed. ${formatMoney(settlement, 2)} paid; shares redistributed to remaining members.`
        : 'Exit completed with zero settlement. Share seat removed and redistributed.',
    };
  } catch (err) {
    if (settlement > 0 && bankDebit) {
      try {
        await credit({
          type: 'deposit',
          amount: settlement,
          referenceType: 'Deposit',
          referenceId: exitDeposit?._id || null,
          note: `Rollback member-exit payout for ${member.name}`,
          createdBy: processedBy,
        });
      } catch (_) {
        // preserve original error
      }
    }
    throw err;
  }
}

module.exports = {
  OPEN_EXIT_STATUSES,
  buildRedistributionPlan,
  buildApprovalTracking,
  previewMemberExit,
  initiateMemberExit,
  listOpenExitRequests,
  listCashierExitQueue,
  getExitRequestById,
  listPendingExitRequestsForMember,
  approveExitByDepartingMember,
  rejectExitByDepartingMember,
  approveExitByMember,
  cancelMemberExit,
  completeCashierMemberExit,
};
