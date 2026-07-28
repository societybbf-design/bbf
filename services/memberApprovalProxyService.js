const Investment = require('../models/Investment');
const MemberExitRequest = require('../models/MemberExitRequest');
const User = require('../models/User');
const { recordAudit } = require('./securityService');
const { isDeveloperRole, userHasPermission } = require('./rbac');
const {
  approveInvestmentByMember,
  buildApprovalTracking,
} = require('./investmentService');
const {
  approveExitByDepartingMember,
  approveExitByMember,
  buildApprovalTracking: buildExitApprovalTracking,
} = require('./memberExitService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertProxyActor(actor) {
  if (!actor) {
    throw httpError('Authentication required.', 401);
  }
  if (isDeveloperRole(actor.role) || userHasPermission(actor, 'can_proxy_member_approvals')) {
    return;
  }
  throw httpError('You do not have permission to record proxy member approvals.', 403);
}

function buildProxyMeta(actor, reason) {
  const trimmed = String(reason || '').trim();
  if (!trimmed || trimmed.length < 3) {
    throw httpError('A reason is required for proxy approval (at least 3 characters).');
  }
  return {
    proxiedBy: actor.id || actor._id,
    proxiedByName: actor.name || actor.email || 'User Management',
    proxiedByRole: actor.role || 'developer',
    proxyReason: trimmed,
  };
}

function investmentLabel(investment) {
  const code = investment.investmentCode || 'Project';
  const subtitle = [investment.sector, investment.partner].filter(Boolean).join(' · ');
  return subtitle ? `${code} — ${subtitle}` : code;
}

async function loadMemberMap(memberIds) {
  const unique = [...new Set(memberIds.map((id) => String(id)).filter(Boolean))];
  if (!unique.length) return new Map();
  const members = await User.find({ _id: { $in: unique } })
    .select('name email role status')
    .lean();
  return new Map(members.map((member) => [String(member._id), member]));
}

async function listPendingMemberApprovalQueues() {
  const [investments, exits] = await Promise.all([
    Investment.find({
      member: null,
      status: 'pending_member_approval',
    })
      .select('investmentCode sector partner status eligibleMembers approvals createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    MemberExitRequest.find({
      status: { $in: ['pending_departing_approval', 'pending_member_approval'] },
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const memberIds = [];
  for (const investment of investments) {
    for (const id of investment.eligibleMembers || []) memberIds.push(id);
  }
  for (const exitRequest of exits) {
    memberIds.push(exitRequest.departingMember);
    for (const id of exitRequest.eligibleMembers || []) memberIds.push(id);
  }

  const memberById = await loadMemberMap(memberIds);
  const items = [];

  for (const investment of investments) {
    const tracking = await buildApprovalTracking(investment, memberById);
    items.push({
      workflowType: 'investment',
      entityId: investment._id,
      label: investmentLabel(investment),
      status: investment.status,
      createdAt: investment.createdAt,
      approvalTracking: tracking,
      pendingApprovals: (tracking.pendingMembers || []).map((member) => ({
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        step: 'member_vote',
        stepLabel: 'Member project vote',
      })),
      approvedApprovals: (tracking.approvedMembers || []).map((member) => ({
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        approvedAt: member.approvedAt,
        isProxied: member.isProxied,
        proxiedByName: member.proxiedByName,
        proxyReason: member.proxyReason,
        step: 'member_vote',
      })),
    });
  }

  for (const exitRequest of exits) {
    const tracking = buildExitApprovalTracking(exitRequest, memberById);
    const pendingApprovals = [];
    const approvedApprovals = [];

    if (exitRequest.status === 'pending_departing_approval') {
      const departing = memberById.get(String(exitRequest.departingMember));
      if (!tracking.departingApproved) {
        pendingApprovals.push({
          memberId: String(exitRequest.departingMember),
          memberName: exitRequest.departingMemberName || departing?.name || 'Departing member',
          memberEmail: exitRequest.departingMemberEmail || departing?.email || '',
          step: 'departing_member',
          stepLabel: 'Departing member consent',
        });
      } else {
        approvedApprovals.push({
          memberId: String(exitRequest.departingMember),
          memberName: exitRequest.departingMemberName || departing?.name || 'Departing member',
          memberEmail: exitRequest.departingMemberEmail || departing?.email || '',
          approvedAt: tracking.departingApprovedAt,
          isProxied: tracking.departingProxied,
          proxiedByName: tracking.departingProxiedByName,
          proxyReason: tracking.departingProxyReason,
          step: 'departing_member',
        });
      }
    }

    if (exitRequest.status === 'pending_member_approval' || tracking.departingApproved) {
      for (const member of tracking.pendingMembers || []) {
        pendingApprovals.push({
          memberId: member.id,
          memberName: member.name,
          memberEmail: member.email,
          step: 'redistribution_vote',
          stepLabel: 'Redistribution vote',
        });
      }
      for (const member of tracking.approvedMembers || []) {
        approvedApprovals.push({
          memberId: member.id,
          memberName: member.name,
          memberEmail: member.email,
          approvedAt: member.approvedAt,
          isProxied: member.isProxied,
          proxiedByName: member.proxiedByName,
          proxyReason: member.proxyReason,
          step: 'redistribution_vote',
        });
      }
    }

    items.push({
      workflowType: 'exit',
      entityId: exitRequest._id,
      label: `Exit: ${exitRequest.departingMemberName || 'Member'}`,
      status: exitRequest.status,
      createdAt: exitRequest.createdAt,
      settlementAmount: exitRequest.settlementAmount,
      approvalTracking: tracking,
      pendingApprovals,
      approvedApprovals,
    });
  }

  const pendingVoteCount = items.reduce((sum, item) => sum + (item.pendingApprovals?.length || 0), 0);

  return {
    items,
    summary: {
      openWorkflows: items.length,
      pendingVotes: pendingVoteCount,
      investmentCount: investments.length,
      exitCount: exits.length,
    },
  };
}

async function recordProxyAudit({
  actor,
  targetMember,
  workflowType,
  entityId,
  entityLabel,
  reason,
  ip,
  success = true,
}) {
  await recordAudit({
    action: 'member_approval_proxied',
    category: 'security',
    actorId: actor?.id || actor?._id || null,
    actorEmail: actor?.email || '',
    actorRole: actor?.role || '',
    targetUserId: targetMember?._id || targetMember?.id || null,
    targetEmail: targetMember?.email || '',
    details: {
      workflowType,
      entityId: String(entityId),
      entityLabel,
      reason,
      targetMemberName: targetMember?.name || '',
    },
    ip: ip || '',
    success,
  });
}

async function proxyApproveInvestment(investmentId, onBehalfOfMemberId, actor, { reason, ip } = {}) {
  assertProxyActor(actor);
  const proxy = buildProxyMeta(actor, reason);

  const targetMember = await User.findOne({
    _id: onBehalfOfMemberId,
    role: 'member',
    status: 'active',
  }).select('name email');
  if (!targetMember) {
    throw httpError('Only active members can be represented in project approvals.', 404);
  }

  const investment = await Investment.findById(investmentId).select('investmentCode sector partner status');
  if (!investment || investment.status !== 'pending_member_approval') {
    throw httpError('This project is not awaiting member approval.', 400);
  }

  const result = await approveInvestmentByMember(investmentId, onBehalfOfMemberId, { proxy });

  await recordProxyAudit({
    actor,
    targetMember,
    workflowType: 'investment',
    entityId: investmentId,
    entityLabel: investmentLabel(investment),
    reason: proxy.proxyReason,
    ip,
  });

  return {
    ...result,
    proxied: true,
    proxy,
    workflowType: 'investment',
  };
}

async function proxyApproveExit(exitRequestId, onBehalfOfMemberId, actor, { reason, ip } = {}) {
  assertProxyActor(actor);
  const proxy = buildProxyMeta(actor, reason);

  const exitRequest = await MemberExitRequest.findById(exitRequestId);
  if (!exitRequest) {
    throw httpError('Exit request not found.', 404);
  }

  let result;
  if (exitRequest.status === 'pending_departing_approval') {
    if (String(exitRequest.departingMember) !== String(onBehalfOfMemberId)) {
      throw httpError('Only the departing member can be represented for this exit step.', 400);
    }
    result = await approveExitByDepartingMember(exitRequestId, onBehalfOfMemberId, { proxy });
  } else if (exitRequest.status === 'pending_member_approval') {
    result = await approveExitByMember(exitRequestId, onBehalfOfMemberId, { proxy });
  } else {
    throw httpError('This exit is not waiting for member-level approval.', 400);
  }

  const targetMember = await User.findById(onBehalfOfMemberId).select('name email');

  await recordProxyAudit({
    actor,
    targetMember,
    workflowType: 'exit',
    entityId: exitRequestId,
    entityLabel: `Exit: ${exitRequest.departingMemberName || 'Member'}`,
    reason: proxy.proxyReason,
    ip,
  });

  return {
    ...result,
    proxied: true,
    proxy,
    workflowType: 'exit',
  };
}

module.exports = {
  assertProxyActor,
  listPendingMemberApprovalQueues,
  proxyApproveInvestment,
  proxyApproveExit,
};
