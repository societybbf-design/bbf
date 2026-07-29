'use strict';

/**
 * Read-only approval progress for Cashier communication.
 * Does not mutate loan or investment state — reuse existing list helpers only.
 */

const LoanApplication = require('../models/LoanApplication');
const Investment = require('../models/Investment');
const {
  buildApprovalTrackingBatch,
  getInvestmentDisplayStatus,
} = require('./investmentService');

function money2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function loanMemberName(loan = {}) {
  return loan.member?.name || loan.memberName || 'Member';
}

function serializeLoanRow(loan, awaiting) {
  return {
    id: String(loan._id),
    memberName: loanMemberName(loan),
    memberEmail: loan.member?.email || '',
    memberPhone: loan.member?.phone || '',
    amount: money2(loan.amount),
    loanType: loan.loanType || 'general',
    status: loan.status,
    createdAt: loan.createdAt || null,
    approvedAt: loan.approvedAt || null,
    reviewedBy: loan.reviewedBy || '',
    paymentMethod: loan.paymentMethod || '',
    awaiting,
    approvalBreakdown: awaiting === 'CEO'
      ? {
          approved: [],
          pending: [{ role: 'CEO', name: 'CEO', status: 'pending' }],
          approvedCount: 0,
          pendingCount: 1,
          totalRequired: 1,
        }
      : {
          approved: [{
            role: 'CEO',
            name: loan.reviewedBy || 'CEO',
            status: 'approved',
            approvedAt: loan.approvedAt || null,
          }],
          pending: [{ role: 'Cashier', name: 'Cashier (disbursement)', status: 'pending' }],
          approvedCount: 1,
          pendingCount: 1,
          totalRequired: 2,
        },
  };
}

async function listLoanApprovalTracking() {
  const [pendingCeo, awaitingCashier] = await Promise.all([
    LoanApplication.find({ status: 'pending' })
      .populate({ path: 'member', select: 'name email phone' })
      .sort({ createdAt: -1 })
      .lean(),
    LoanApplication.find({ status: 'approved' })
      .populate({ path: 'member', select: 'name email phone' })
      .sort({ approvedAt: -1, createdAt: -1 })
      .lean(),
  ]);

  return {
    pendingCeo: pendingCeo.map((loan) => serializeLoanRow(loan, 'CEO')),
    awaitingCashier: awaitingCashier.map((loan) => serializeLoanRow(loan, 'Cashier')),
    counts: {
      pendingCeo: pendingCeo.length,
      awaitingCashier: awaitingCashier.length,
      totalOpen: pendingCeo.length + awaitingCashier.length,
    },
  };
}

async function listProjectApprovalTracking() {
  const projects = await Investment.find({
    status: { $in: ['pending_member_approval', 'pending_cashier_payment'] },
  })
    .populate({ path: 'investor', select: 'name email' })
    .populate({ path: 'projectManager', select: 'name email' })
    .sort({ createdAt: -1 })
    .lean();

  const withTracking = await buildApprovalTrackingBatch(projects);

  const rows = withTracking.map((item) => {
    const tracking = item.approvalTracking || {};
    return {
      id: String(item._id),
      investmentCode: item.investmentCode || '',
      investmentType: item.investmentType || '',
      investorName: item.investor?.name || item.investorName || 'Investor',
      projectManagerName: item.projectManager?.name || '',
      amount: money2(item.amount),
      status: item.status,
      displayStatus: tracking.displayStatus || getInvestmentDisplayStatus(item.status),
      createdAt: item.createdAt || null,
      awaiting: item.status === 'pending_cashier_payment' ? 'Cashier' : 'Members',
      approvalTracking: {
        totalMembers: Number(tracking.totalMembers || 0),
        approvedCount: Number(tracking.approvedCount || 0),
        pendingCount: Number(tracking.pendingCount || 0),
        allApproved: Boolean(tracking.allApproved),
        approvedMembers: tracking.approvedMembers || [],
        pendingMembers: tracking.pendingMembers || [],
      },
    };
  });

  return {
    projects: rows,
    counts: {
      pendingMemberApproval: rows.filter((row) => row.status === 'pending_member_approval').length,
      pendingCashierPayment: rows.filter((row) => row.status === 'pending_cashier_payment').length,
      totalOpen: rows.length,
    },
  };
}

/**
 * Aggregate read-only snapshot for Cashier Approval Tracking panel.
 */
async function getCashierApprovalTracking() {
  const [loans, projects] = await Promise.all([
    listLoanApprovalTracking(),
    listProjectApprovalTracking(),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    loans,
    projects: projects.projects,
    projectCounts: projects.counts,
    summary: {
      loansPendingCeo: loans.counts.pendingCeo,
      loansAwaitingCashier: loans.counts.awaitingCashier,
      projectsPendingMembers: projects.counts.pendingMemberApproval,
      projectsAwaitingCashier: projects.counts.pendingCashierPayment,
      totalOpenItems: loans.counts.totalOpen + projects.counts.totalOpen,
    },
  };
}

module.exports = {
  getCashierApprovalTracking,
  listLoanApprovalTracking,
  listProjectApprovalTracking,
};
