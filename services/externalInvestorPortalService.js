'use strict';

const Investment = require('../models/Investment');
const ExternalInvestorLedger = require('../models/ExternalInvestorLedger');
const ExternalInvestorLedgerEntry = require('../models/ExternalInvestorLedgerEntry');
const ExternalPayoutRequest = require('../models/ExternalPayoutRequest');
const ProjectManagerReview = require('../models/ProjectManagerReview');
const User = require('../models/User');
const {
  debitExternalCapitalOut,
  debitExternalProfitPayout,
  money,
} = require('./externalInvestorLedgerService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertExternalInvestor(actor) {
  const role = String(actor?.role || '').toLowerCase();
  if (role !== 'external_investor') {
    throw httpError('External Investor access only.', 403);
  }
  const id = actor.id || actor._id;
  if (!id) throw httpError('Not authenticated.', 401);
  return String(id);
}

function stakeMatchesInvestor(investment, investorId) {
  const stakes = Array.isArray(investment.externalInvestors) ? investment.externalInvestors : [];
  return stakes.some((row) => String(row.investor?._id || row.investor || '') === String(investorId));
}

/**
 * Isolated portfolio: only projects where this user holds an external stake.
 * Never exposes society pool totals, member lists, or unrelated projects.
 */
async function getExternalInvestorDashboard(actor) {
  const investorId = assertExternalInvestor(actor);
  const investments = await Investment.find({
    'externalInvestors.investor': investorId,
    status: { $in: ['pending_member_approval', 'pending_ceo_authorization', 'pending_cashier_payment', 'active', 'sold', 'closed'] },
  })
    .select(
      // Intentionally omit society pool / member-facing fields for isolation.
      'investmentCode investmentType projectAsset projectAssetCategory location status returnMode '
      + 'externalInvestors projectManager '
      + 'closedAt soldAt createdAt'
    )
    .populate('projectManager', 'name email phone role')
    .sort({ createdAt: -1 })
    .lean();

  const projects = investments.map((inv) => {
    const stake = (inv.externalInvestors || []).find(
      (row) => String(row.investor?._id || row.investor || '') === investorId
    ) || null;
    return {
      id: inv._id,
      investmentCode: inv.investmentCode,
      investmentType: inv.investmentType,
      projectAssetCategory: inv.projectAssetCategory || '',
      projectAsset: inv.projectAsset || '',
      location: inv.location || '',
      status: inv.status,
      returnMode: inv.returnMode,
      ownershipPct: money(stake?.ownershipPct || 0),
      capitalCommitted: money(stake?.amount || 0),
      capitalReceived: money(stake?.capitalReceived || 0),
      profitBalance: money(stake?.profitBalance || 0),
      projectManager: inv.projectManager
        ? {
          id: inv.projectManager._id,
          name: inv.projectManager.name,
          email: inv.projectManager.email,
          phone: inv.projectManager.phone || '',
        }
        : null,
      closedAt: inv.closedAt || inv.soldAt || null,
      createdAt: inv.createdAt,
    };
  });

  const investmentIds = investments.map((row) => row._id);
  const { listExternalInvestorExpenseApprovals } = require('./projectOpsService');
  const [ledgers, deposits, payoutRequests, reviews, expenseApprovals] = await Promise.all([
    ExternalInvestorLedger.find({ investment: { $in: investmentIds } }).lean(),
    // Isolated to this investor's projects only; include project-level posts (null investor).
    ExternalInvestorLedgerEntry.find({
      investment: { $in: investmentIds },
      $or: [
        { investor: investorId },
        { investor: null },
        { investor: { $exists: false } },
      ],
      type: {
        $in: [
          'external_capital_in',
          'external_profit_accrual',
          'external_profit_payout',
          'external_expense_share',
          'external_capital_out',
        ],
      },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    ExternalPayoutRequest.find({ investor: investorId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    ProjectManagerReview.find({ reviewer: investorId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    listExternalInvestorExpenseApprovals(investorId),
  ]);

  const ledgerByInvestment = new Map(ledgers.map((row) => [String(row.investment), row]));
  const totals = {
    projects: projects.length,
    capitalCommitted: money(projects.reduce((s, p) => s + Number(p.capitalCommitted || 0), 0)),
    capitalReceived: money(projects.reduce((s, p) => s + Number(p.capitalReceived || 0), 0)),
    profitBalance: money(projects.reduce((s, p) => s + Number(p.profitBalance || 0), 0)),
    pendingApprovals: payoutRequests.filter((r) => r.status === 'pending_external_approval').length
      + (expenseApprovals || []).length,
  };

  return {
    investorId,
    totals,
    projects: projects.map((p) => ({
      ...p,
      ledgerBalance: money(ledgerByInvestment.get(String(p.id))?.bookBalance || 0),
    })),
    deposits: deposits.map((row) => ({
      id: row._id,
      investmentId: row.investment,
      type: row.type,
      direction: row.direction,
      amount: money(row.amount),
      note: row.note || '',
      payoutStatus: row.payoutStatus || '',
      createdAt: row.createdAt,
      createdBy: row.createdBy || '',
    })),
    payoutRequests: payoutRequests.map((row) => ({
      id: row._id,
      investmentId: row.investment,
      investmentCode: row.investmentCode,
      kind: row.kind,
      capitalAmount: money(row.capitalAmount),
      profitAmount: money(row.profitAmount),
      externalExtraExpenses: money(row.externalExtraExpenses),
      amount: money(row.amount),
      status: row.status,
      source: row.source,
      note: row.note || '',
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    })),
    reviews: reviews.map((row) => ({
      id: row._id,
      investmentCode: row.investmentCode,
      projectManagerName: row.projectManagerName,
      rating: row.rating,
      feedback: row.feedback,
      createdAt: row.createdAt,
    })),
    expenseApprovals: (expenseApprovals || []).map((row) => {
      const mine = (row.externalApprovals || []).find(
        (a) => String(a.investor) === String(investorId)
      );
      return {
        id: row._id,
        investmentCode: row.investmentCode,
        description: row.description,
        amount: money(row.amount),
        externalShare: money(row.externalShare),
        yourShare: money(mine?.shareAmount || 0),
        status: row.status,
        submittedAt: row.submittedAt,
        createdAt: row.createdAt,
      };
    }),
  };
}

async function decideExternalPayoutRequest(actor, requestId, { approve = true, note = '' } = {}) {
  const investorId = assertExternalInvestor(actor);
  const request = await ExternalPayoutRequest.findById(requestId);
  if (!request) throw httpError('Payout request not found.', 404);
  if (String(request.investor) !== investorId) {
    throw httpError('This payout request does not belong to your account.', 403);
  }
  if (request.status !== 'pending_external_approval') {
    throw httpError(`Request is already ${request.status}.`, 409);
  }

  request.decidedAt = new Date();
  request.decidedBy = String(actor.name || actor.email || investorId);
  request.decisionNote = String(note || '').trim();

  if (!approve) {
    request.status = 'rejected';
    await request.save();
    return { request, message: 'Payout request rejected.' };
  }

  // External Investor approval only — CEO executes final ledger disbursement.
  request.status = 'approved';
  await request.save();

  const { createAdminNotification } = require('./adminNotificationService');
  await createAdminNotification({
    type: 'general',
    title: `External payout approved — CEO payment needed: ${request.investmentCode}`,
    message: `${request.investorName || 'External Investor'} approved ${money(request.amount)}. `
      + 'Execute final disbursement from their external ledger.',
    relatedId: request._id,
    relatedModel: 'ExternalPayoutRequest',
    targetRoles: ['ceo'],
  }).catch(() => {});

  return {
    request,
    message: `Payout of ${money(request.amount)} approved. Awaiting CEO final disbursement from your external ledger.`,
  };
}

/**
 * CEO executes an External Investor–approved payout / settlement from the project external ledger.
 */
async function ceoExecuteExternalPayout(requestId, { executedBy = 'CEO', note = '' } = {}) {
  const request = await ExternalPayoutRequest.findById(requestId);
  if (!request) throw httpError('Payout request not found.', 404);
  if (request.status !== 'approved') {
    throw httpError(
      `Only External Investor–approved requests can be paid by CEO (status: ${request.status}).`,
      409
    );
  }

  const investment = await Investment.findById(request.investment);
  if (!investment) throw httpError('Linked project not found.', 404);

  const ledgerEntryIds = [];
  const capitalAmount = money(request.capitalAmount);
  const profitAmount = money(request.profitAmount);

  if (capitalAmount > 0.001) {
    const out = await debitExternalCapitalOut(investment, capitalAmount, {
      investor: request.investor,
      investorName: request.investorName,
      note: note || request.note || `CEO capital return ${request.investmentCode}`,
      createdBy: executedBy,
      referenceType: 'ExternalPayoutRequest',
      referenceId: request._id,
    });
    ledgerEntryIds.push(out.entry._id);
  }
  if (profitAmount > 0.001) {
    const out = await debitExternalProfitPayout(investment, profitAmount, {
      investor: request.investor,
      investorName: request.investorName,
      note: note || request.note || `CEO profit payout ${request.investmentCode}`,
      createdBy: executedBy,
      referenceType: 'ExternalPayoutRequest',
      referenceId: request._id,
      payoutStatus: 'paid',
    });
    ledgerEntryIds.push(out.entry._id);
  }

  request.status = 'paid';
  request.executedAt = new Date();
  request.executedBy = String(executedBy || 'CEO').trim();
  if (note) request.decisionNote = [request.decisionNote, note].filter(Boolean).join(' | ');
  request.ledgerEntryIds = [...(request.ledgerEntryIds || []), ...ledgerEntryIds];
  await request.save();

  return {
    request,
    message: `Paid ${money(request.amount)} from external ledger for ${request.investmentCode}.`,
  };
}

async function submitProjectManagerReview(actor, {
  investmentId,
  rating,
  feedback = '',
} = {}) {
  const investorId = assertExternalInvestor(actor);
  const score = Number(rating);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw httpError('Rating must be between 1 and 5.');
  }
  const investment = await Investment.findById(investmentId)
    .populate('projectManager', 'name email role');
  if (!investment) throw httpError('Project not found.', 404);
  if (!stakeMatchesInvestor(investment, investorId)) {
    throw httpError('You can only review project managers on your assigned projects.', 403);
  }
  if (!investment.projectManager) {
    throw httpError('This project has no assigned Project Manager.');
  }

  const review = await ProjectManagerReview.create({
    investment: investment._id,
    investmentCode: investment.investmentCode || '',
    projectManager: investment.projectManager._id,
    projectManagerName: investment.projectManager.name || '',
    reviewer: investorId,
    reviewerName: String(actor.name || '').trim(),
    rating: score,
    feedback: String(feedback || '').trim().slice(0, 2000),
  });

  return {
    review,
    message: 'Thank you — your Project Manager review was submitted.',
  };
}

/**
 * Chat peers for an external investor: CEO users + Project Managers
 * assigned to their projects only.
 */
async function getExternalInvestorChatPeers(actor) {
  const investorId = assertExternalInvestor(actor);
  const investments = await Investment.find({
    'externalInvestors.investor': investorId,
  })
    .select('projectManager')
    .lean();

  const pmIds = [
    ...new Set(
      investments
        .map((row) => String(row.projectManager || ''))
        .filter(Boolean)
    ),
  ];

  const peers = await User.find({
    status: { $in: ['active', 'inactive'] },
    $or: [
      { role: { $in: ['ceo', 'admin'] } },
      { _id: { $in: pmIds }, role: 'project_manager' },
    ],
  })
    .select('name email role status')
    .sort({ name: 1 })
    .lean();

  return peers.map((peer) => ({
    userId: peer._id,
    name: peer.name,
    email: peer.email,
    role: peer.role,
    status: peer.status,
  }));
}

async function queueExternalSettlementPayouts({
  investment,
  investorPayouts = [],
  externalExtraExpenses = 0,
  source = 'liquidation',
  referenceType = '',
  referenceId = null,
  note = '',
  createdBy = '',
  session = null,
} = {}) {
  const extra = money(Math.max(0, externalExtraExpenses));
  const rows = Array.isArray(investorPayouts) ? investorPayouts : [];
  const created = [];
  let remainingExtra = extra;

  // Deduct external-specific expense from external profit first, then queue remainder + capital.
  for (const row of rows) {
    const capitalAmount = money(Math.max(0, Number(row.capitalShare || 0)));
    let profitPool = money(Math.max(
      0,
      Number(row.profitShare || 0) - Number(row.lossShare || 0) + Number(row.accruedProfit || 0)
    ));
    // Fallback when only aggregate payout is provided.
    if (!(capitalAmount > 0) && !(profitPool > 0) && Number(row.payout || 0) > 0) {
      profitPool = money(row.payout);
    }
    let expenseTaken = 0;
    if (remainingExtra > 0.001 && profitPool > 0.001) {
      expenseTaken = money(Math.min(remainingExtra, profitPool));
      profitPool = money(profitPool - expenseTaken);
      remainingExtra = money(remainingExtra - expenseTaken);
    }
    const profitAmount = profitPool;
    const amount = money(capitalAmount + profitAmount);
    if (!(amount > 0.001)) continue;
    if (!row.investor) continue;

    const payload = {
      investment: investment._id,
      investmentCode: investment.investmentCode || '',
      investor: row.investor,
      investorName: row.investorName || '',
      kind: source === 'monthly_return' ? 'profit' : 'settlement',
      capitalAmount,
      profitAmount,
      externalExtraExpenses: expenseTaken,
      amount,
      status: 'pending_external_approval',
      source,
      referenceType,
      referenceId,
      note: note || `Settlement payout for ${investment.investmentCode || investment._id}`,
      createdBy,
    };
    const doc = session
      ? (await ExternalPayoutRequest.create([payload], { session }))[0]
      : await ExternalPayoutRequest.create(payload);
    created.push(doc);
  }

  return { requests: created, externalExtraExpensesApplied: money(extra - remainingExtra) };
}

module.exports = {
  money,
  getExternalInvestorDashboard,
  decideExternalPayoutRequest,
  ceoExecuteExternalPayout,
  submitProjectManagerReview,
  getExternalInvestorChatPeers,
  queueExternalSettlementPayouts,
  stakeMatchesInvestor,
  assertExternalInvestor,
};
