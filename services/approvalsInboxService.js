const { formatMoney } = require('./moneyFormat');
const { userHasPermission, normalizeRole, isFullAccessRole } = require('./rbac');
const {
  listPendingMemberInvestmentRequests,
} = require('./investmentService');
const {
  listPendingExitRequestsForMember,
  listOpenExitRequests,
} = require('./memberExitService');
const Investment = require('../models/Investment');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const KycDocument = require('../models/KycDocument');
const Refund = require('../models/Refund');
const MemberExitRequest = require('../models/MemberExitRequest');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function item({
  id,
  type,
  title,
  subtitle = '',
  amount = null,
  status = '',
  priority = 'normal',
  createdAt = null,
  entityId,
  actions = [],
  details = {},
  deepLink = null,
}) {
  return {
    id,
    type,
    title,
    subtitle,
    amount: amount == null ? null : money(amount),
    amountLabel: amount == null ? null : formatMoney(amount, 2),
    status,
    priority,
    createdAt,
    entityId: String(entityId),
    actions,
    details,
    deepLink,
  };
}

async function collectMemberItems(user) {
  const memberId = user.id || user._id;
  const items = [];

  const [investments, exits] = await Promise.all([
    listPendingMemberInvestmentRequests(memberId),
    listPendingExitRequestsForMember(memberId),
  ]);

  for (const inv of investments || []) {
    if (inv.alreadyApproved) continue;
    const isExpansion = inv.fundingKind === 'capital_expansion' || inv.isCapitalExpansion;
    items.push(item({
      id: `investment_vote:${inv._id}`,
      type: 'investment_vote',
      title: isExpansion
        ? `Approve capital expansion ${inv.investmentCode || ''}`.trim()
        : `Approve project ${inv.investmentCode || ''}`.trim(),
      subtitle: isExpansion
        ? `Expand ${inv.parentInvestment?.investmentCode || 'running project'} by additional capital`
        : [inv.investmentType, inv.investor?.name || inv.investorName].filter(Boolean).join(' · '),
      amount: inv.amount,
      status: inv.status,
      priority: 'high',
      createdAt: inv.createdAt,
      entityId: inv._id,
      actions: [
        { key: 'approve', label: 'Accept', method: 'POST', path: `/api/member/investment-requests/${inv._id}/approve` },
        { key: 'view', label: 'View details' },
      ],
      details: {
        approvalCount: inv.approvalCount,
        requiredApprovals: inv.requiredApprovals,
        displayStatus: inv.displayStatus,
        fundingKind: inv.fundingKind || 'initial',
        parentInvestmentCode: inv.parentInvestment?.investmentCode || '',
      },
      deepLink: { dashboard: 'member', hash: '#investment-requests' },
    }));
  }

  for (const exitReq of exits || []) {
    const status = exitReq.status;
    const settlement = exitReq.settlementAmount;
    if (status === 'pending_departing_approval') {
      items.push(item({
        id: `exit_departing:${exitReq._id}`,
        type: 'exit_departing',
        title: 'Approve your member exit',
        subtitle: 'Confirm settlement and begin redistribution approvals',
        amount: settlement,
        status,
        priority: 'high',
        createdAt: exitReq.createdAt,
        entityId: exitReq._id,
        actions: [
          { key: 'approve', label: 'Accept', method: 'POST', path: `/api/member/exit-requests/${exitReq._id}/approve` },
          { key: 'reject', label: 'Reject', method: 'POST', path: `/api/member/exit-requests/${exitReq._id}/reject`, body: { reason: 'Rejected by departing member' } },
          { key: 'view', label: 'View details' },
        ],
        deepLink: { dashboard: 'member', hash: '#investment-requests' },
      }));
    } else if (status === 'pending_member_approval') {
      items.push(item({
        id: `exit_redistribution:${exitReq._id}`,
        type: 'exit_redistribution',
        title: `Approve exit redistribution — ${exitReq.departingMemberName || 'Member'}`,
        subtitle: 'Remaining members must approve share redistribution before Cashier payout',
        amount: settlement,
        status,
        priority: 'high',
        createdAt: exitReq.createdAt,
        entityId: exitReq._id,
        actions: [
          { key: 'approve', label: 'Accept', method: 'POST', path: `/api/member/exit-requests/${exitReq._id}/approve` },
          { key: 'view', label: 'View details' },
        ],
        deepLink: { dashboard: 'member', hash: '#investment-requests' },
      }));
    }
  }

  return items;
}

async function collectStaffItems(user) {
  const items = [];
  const role = normalizeRole(user.role);
  const isCashier = role === 'cashier';

  if (userHasPermission(user, 'can_manage_loans')) {
    const pendingLoans = await LoanApplication.find({ status: 'pending' })
      .populate('member', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const loan of pendingLoans) {
      items.push(item({
        id: `loan_application:${loan._id}`,
        type: 'loan_application',
        title: `Review loan — ${loan.member?.name || 'Member'}`,
        subtitle: `${loan.loanType || 'Loan'} · ${loan.purpose || 'No purpose noted'}`,
        amount: loan.amount,
        status: loan.status,
        priority: 'high',
        createdAt: loan.createdAt,
        entityId: loan._id,
        actions: [
          {
            key: 'approve',
            label: 'Accept',
            method: 'PATCH',
            path: `/api/loans/admin/${loan._id}`,
            body: { status: 'approved', paymentMethod: 'bank_transfer', adminNote: 'Approved from Approvals inbox' },
            requiresPassword: true,
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'PATCH',
            path: `/api/loans/admin/${loan._id}`,
            body: { status: 'rejected', adminNote: 'Rejected from Approvals inbox' },
            requiresPassword: true,
          },
          { key: 'view', label: 'View details', method: 'GET', path: `/api/loans/admin/${loan._id}` },
        ],
        deepLink: { dashboard: 'admin', hash: '#loans' },
      }));
    }
  }

  if (userHasPermission(user, 'can_manage_kyc')) {
    const pendingKyc = await KycDocument.find({ status: 'pending' })
      .populate('member', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const doc of pendingKyc) {
      items.push(item({
        id: `kyc_document:${doc._id}`,
        type: 'kyc_document',
        title: `KYC review — ${doc.member?.name || 'Member'}`,
        subtitle: `${doc.documentType || 'Document'} · ${doc.originalName || ''}`.trim(),
        status: doc.status,
        priority: 'normal',
        createdAt: doc.createdAt,
        entityId: doc._id,
        actions: [
          {
            key: 'approve',
            label: 'Accept',
            method: 'PATCH',
            path: `/api/kyc/admin/${doc._id}`,
            body: { status: 'verified', adminNote: 'Verified from Approvals inbox' },
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'PATCH',
            path: `/api/kyc/admin/${doc._id}`,
            body: { status: 'rejected', adminNote: 'Rejected from Approvals inbox' },
          },
        ],
        deepLink: { dashboard: role === 'employee' ? 'staff' : 'admin', hash: role === 'employee' ? '#approvals' : '#settings' },
      }));
    }
  }

  // CEO reviews pending withdrawal requests.
  if (userHasPermission(user, 'can_manage_withdrawals') && !isCashier) {
    const pendingWithdrawals = await WithdrawalRequest.find({ status: 'pending' })
      .populate('member', 'name email advanceBalance')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const row of pendingWithdrawals) {
      items.push(item({
        id: `withdrawal:${row._id}`,
        type: 'withdrawal',
        title: `Withdrawal — ${row.member?.name || 'Member'}`,
        subtitle: `Awaiting CEO approval · Advance ${formatMoney(Number(row.member?.advanceBalance || 0), 2)}`,
        amount: row.amount,
        status: row.status,
        priority: 'high',
        createdAt: row.createdAt,
        entityId: row._id,
        actions: [
          {
            key: 'approve',
            label: 'Accept',
            method: 'POST',
            path: `/api/withdrawals/admin/${row._id}/approve`,
            body: {},
            requiresPassword: true,
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'POST',
            path: `/api/withdrawals/admin/${row._id}/reject`,
            body: {},
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'admin', hash: '#withdrawals' },
      }));
    }
  }

  // Cashier pays only CEO-approved withdrawals from Advance Balance.
  if (userHasPermission(user, 'can_disburse_withdrawals') && isCashier) {
    const approvedWithdrawals = await WithdrawalRequest.find({ status: 'approved' })
      .populate('member', 'name email advanceBalance')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const row of approvedWithdrawals) {
      const advance = Number(row.member?.advanceBalance || 0);
      const enough = advance + 0.001 >= Number(row.amount || 0);
      items.push(item({
        id: `withdrawal_pay:${row._id}`,
        type: 'withdrawal',
        title: `Withdrawal payout — ${row.member?.name || 'Member'}`,
        subtitle: enough
          ? `CEO approved · Advance ${formatMoney(advance, 2)} — ready to pay`
          : `CEO approved · Insufficient Advance ${formatMoney(advance, 2)} — payout blocked`,
        amount: row.amount,
        status: row.status,
        priority: enough ? 'high' : 'normal',
        createdAt: row.createdAt,
        entityId: row._id,
        actions: enough
          ? [{
            key: 'complete',
            label: 'Pay from Advance',
            method: 'POST',
            path: `/api/withdrawals/admin/${row._id}/cashier-complete`,
            body: { paymentMethod: 'cash' },
            requiresPassword: true,
          }]
          : [],
        deepLink: { dashboard: 'staff', hash: '#withdrawals' },
      }));
    }
  }

  if (userHasPermission(user, 'can_manage_members') && !isCashier) {
    const openExits = await listOpenExitRequests();
    for (const exitReq of openExits || []) {
      const canCancel = ['pending_departing_approval', 'pending_member_approval'].includes(exitReq.status);
      items.push(item({
        id: `exit_monitor:${exitReq._id}`,
        type: 'exit_monitor',
        title: `Member exit — ${exitReq.departingMemberName || 'Member'}`,
        subtitle: `Status: ${exitReq.status.replace(/_/g, ' ')}`,
        amount: exitReq.settlementAmount,
        status: exitReq.status,
        priority: 'normal',
        createdAt: exitReq.createdAt,
        entityId: exitReq._id,
        actions: canCancel
          ? [{
            key: 'reject',
            label: 'Cancel exit',
            method: 'POST',
            path: `/api/admin/member-exits/${exitReq._id}/cancel`,
            body: { reason: 'Cancelled from Approvals inbox' },
            requiresPassword: true,
          }]
          : [{ key: 'view', label: 'View details', method: 'GET', path: '/api/admin/member-exits' }],
        deepLink: { dashboard: 'admin', hash: '#ceo' },
      }));
    }
  }

  if (userHasPermission(user, 'can_manage_investments') && !isCashier) {
    const pendingInvestments = await Investment.find({
      member: null,
      status: {
        $in: ['pending_member_approval', 'pending_ceo_authorization', 'pending_cashier_payment'],
      },
      ...(user.role === 'project_manager'
        ? { projectManager: user.id || user._id }
        : {}),
    })
      .populate('investor', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const inv of pendingInvestments) {
      const isExpansion = inv.fundingKind === 'capital_expansion';
      const statusLabel = inv.status === 'pending_member_approval'
        ? (isExpansion ? 'Awaiting member approvals for capital expansion' : 'Awaiting member approvals')
        : inv.status === 'pending_ceo_authorization'
          ? (isExpansion ? 'Awaiting CEO authorization for capital expansion' : 'Awaiting CEO authorization')
          : (isExpansion ? 'Awaiting Cashier payment for capital expansion' : 'Awaiting Cashier payment');
      items.push(item({
        id: `investment_monitor:${inv._id}`,
        type: 'investment_monitor',
        title: isExpansion
          ? `Capital expansion — ${inv.investmentCode || 'Investment'}`
          : `Project workflow — ${inv.investmentCode || 'Investment'}`,
        subtitle: statusLabel,
        amount: inv.amount,
        status: inv.status,
        priority: inv.status === 'pending_ceo_authorization' ? 'high' : 'normal',
        createdAt: inv.createdAt,
        entityId: inv._id,
        actions: [
          { key: 'view', label: 'View details', method: 'GET', path: `/api/admin/investments/${inv._id}/approvals` },
        ],
        details: {
          projectCode: inv.investmentCode || '',
          investmentType: inv.investmentType || '',
          investor: inv.investor?.name || inv.investorName || '',
          location: inv.location || '',
          returnMode: inv.returnMode === 'monthly' ? 'Monthly return' : (inv.returnMode || 'Fixed/term'),
          fundingKind: inv.fundingKind || 'initial',
        },
        deepLink: { dashboard: user.role === 'project_manager' ? 'staff' : 'admin', hash: user.role === 'project_manager' ? '#investments' : '#projects' },
      }));
    }
  }

  // CEO authorization queue (after member approvals, before cashier).
  if (isFullAccessRole(user.role) || user.role === 'ceo' || user.role === 'admin') {
    const awaitingCeo = await Investment.find({
      member: null,
      status: 'pending_ceo_authorization',
    })
      .populate('investor', 'name email')
      .populate('projectManager', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const inv of awaitingCeo) {
      const isExpansion = inv.fundingKind === 'capital_expansion';
      items.push(item({
        id: `investment_ceo_auth:${inv._id}`,
        type: 'investment_ceo_authorization',
        title: isExpansion
          ? `Authorize capital expansion — ${inv.investmentCode || 'Investment'}`
          : `Authorize project — ${inv.investmentCode || 'Investment'}`,
        subtitle: `Members approved · ${inv.projectManager?.name || 'PM'} · final CEO authorization required`,
        amount: inv.amount,
        status: inv.status,
        priority: 'high',
        createdAt: inv.updatedAt || inv.createdAt,
        entityId: inv._id,
        actions: [
          {
            key: 'approve',
            label: 'Authorize → Cashier queue',
            method: 'POST',
            path: `/api/admin/investments/${inv._id}/ceo-authorize`,
            body: { approve: true },
            requiresPassword: true,
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'POST',
            path: `/api/admin/investments/${inv._id}/ceo-authorize`,
            body: { approve: false },
            requiresPassword: true,
          },
        ],
        details: {
          projectCode: inv.investmentCode || '',
          fundingKind: inv.fundingKind || 'initial',
          projectManager: inv.projectManager?.name || '',
        },
        deepLink: { dashboard: 'admin', hash: '#approvals' },
      }));
    }

    try {
      const { listPendingCeoProjectOps } = require('./projectOpsService');
      const ops = await listPendingCeoProjectOps();
      for (const exp of ops.expenses || []) {
        const awaitingCeoPay = exp.status === 'external_approved';
        items.push(item({
          id: `project_expense:${exp._id}`,
          type: awaitingCeoPay ? 'project_expense_disburse' : 'project_expense_review',
          title: awaitingCeoPay
            ? `Disburse external expense — ${exp.investmentCode || 'Project'}`
            : `Project expense — ${exp.investmentCode || 'Project'}`,
          subtitle: awaitingCeoPay
            ? `${exp.description || 'Operational expense'} · External Investor approved — pay from external ledger`
            : exp.description || 'Operational expense',
          amount: awaitingCeoPay ? exp.externalShare : exp.amount,
          status: exp.status,
          priority: awaitingCeoPay ? 'high' : 'normal',
          createdAt: exp.submittedAt || exp.createdAt,
          entityId: exp._id,
          actions: [
            {
              key: 'approve',
              label: awaitingCeoPay ? 'Pay from external ledger' : 'Approve',
              method: 'POST',
              path: `/api/admin/investments/expenses/${exp._id}/ceo-review`,
              body: { approve: true, executeSocietyDebit: true },
              requiresPassword: true,
            },
            {
              key: 'reject',
              label: 'Reject',
              method: 'POST',
              path: `/api/admin/investments/expenses/${exp._id}/ceo-review`,
              body: { approve: false },
              requiresPassword: true,
            },
          ],
          deepLink: { dashboard: 'admin', hash: '#approvals' },
        }));
      }
      for (const report of ops.reports || []) {
        items.push(item({
          id: `project_pnl:${report._id}`,
          type: 'project_monthly_report',
          title: `Monthly P&L — ${report.investmentCode} (${report.yearMonth})`,
          subtitle: `Gross ${formatMoney(report.grossRevenue, 2)} − Expenses ${formatMoney(report.totalExpenses, 2)} = Net ${formatMoney(report.netProfit, 2)}`,
          amount: report.netProfit,
          status: report.status,
          priority: 'high',
          createdAt: report.submittedAt || report.createdAt,
          entityId: report._id,
          actions: [
            {
              key: 'approve',
              label: 'Approve → external payout channel',
              method: 'POST',
              path: `/api/admin/investments/monthly-reports/${report._id}/ceo-review`,
              body: { approve: true },
              requiresPassword: true,
            },
            {
              key: 'reject',
              label: 'Reject',
              method: 'POST',
              path: `/api/admin/investments/monthly-reports/${report._id}/ceo-review`,
              body: { approve: false },
              requiresPassword: true,
            },
          ],
          deepLink: { dashboard: 'admin', hash: '#approvals' },
        }));
      }
    } catch (error) {
      console.warn('[approvals] project ops inbox skipped:', error.message);
    }
  }

  if (userHasPermission(user, 'can_manage_deposits') || isCashier) {
    const cashierQueue = await Investment.find({
      member: null,
      status: 'pending_cashier_payment',
    })
      .populate('investor', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const inv of cashierQueue) {
      const isExpansion = inv.fundingKind === 'capital_expansion' || inv.isCapitalExpansion;
      items.push(item({
        id: `investment_cashier_payment:${inv._id}`,
        type: 'investment_cashier_payment',
        title: isExpansion
          ? `Pay capital expansion — ${inv.investmentCode || 'Investment'}`
          : `Pay project — ${inv.investmentCode || 'Investment'}`,
        subtitle: isExpansion
          ? (inv.queueLabel || `Expand ${inv.parentInvestment?.investmentCode || 'running project'}`)
          : (inv.investor?.name || inv.investorName || 'Society project'),
        amount: inv.amount,
        status: inv.status,
        priority: 'high',
        createdAt: inv.createdAt,
        entityId: inv._id,
        actions: [
          {
            key: 'complete',
            label: 'Complete payment',
            method: 'POST',
            path: `/api/admin/investments/${inv._id}/cashier-complete`,
            body: {},
            requiresPassword: true,
          },
          { key: 'view', label: 'View details', method: 'GET', path: `/api/admin/investments/${inv._id}/approvals` },
        ],
        details: {
          projectCode: inv.investmentCode || '',
          investmentType: inv.investmentType || '',
          investor: inv.investor?.name || inv.investorName || '',
          societyAmount: inv.societyAmount != null ? formatMoney(inv.societyAmount, 2) : '',
          fundingKind: inv.fundingKind || 'initial',
          parentInvestmentCode: inv.parentInvestment?.investmentCode || '',
        },
        deepLink: { dashboard: 'staff', hash: '#queue' },
      }));
    }
  }

  if (isCashier) {
    const exitQueue = await MemberExitRequest.find({ status: 'pending_cashier_payment' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const exitReq of exitQueue) {
      items.push(item({
        id: `exit_cashier_payout:${exitReq._id}`,
        type: 'exit_cashier_payout',
        title: `Pay exit settlement — ${exitReq.departingMemberName || 'Member'}`,
        subtitle: 'All approvals complete — Cashier payout required',
        amount: exitReq.settlementAmount,
        status: exitReq.status,
        priority: 'high',
        createdAt: exitReq.createdAt,
        entityId: exitReq._id,
        actions: [
          {
            key: 'complete',
            label: 'Complete payout',
            method: 'POST',
            path: `/api/admin/member-exits/${exitReq._id}/cashier-complete`,
            body: {},
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'staff', hash: '#queue' },
      }));
    }
  }

  if (userHasPermission(user, 'can_disburse_loans')) {
    const approvedLoans = await LoanApplication.find({ status: 'approved' })
      .populate('member', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const loan of approvedLoans) {
      items.push(item({
        id: `loan_disbursement:${loan._id}`,
        type: 'loan_disbursement',
        title: `Disburse loan — ${loan.member?.name || 'Member'}`,
        subtitle: 'CEO approved — awaiting Cashier disbursement',
        amount: loan.amount,
        status: loan.status,
        priority: 'high',
        createdAt: loan.updatedAt || loan.createdAt,
        entityId: loan._id,
        actions: [
          {
            key: 'complete',
            label: 'Disburse',
            method: 'POST',
            path: `/api/loans/admin/${loan._id}/disburse`,
            body: { paymentMethod: 'bank_transfer', disbursementNote: 'Disbursed from Approvals inbox' },
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'staff', hash: '#loans' },
      }));
    }

    const pendingRepayments = await LoanRepayment.find({ status: 'pending' })
      .populate('member', 'name email')
      .populate('loan', 'loanType amount')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const row of pendingRepayments) {
      items.push(item({
        id: `loan_repayment:${row._id}`,
        type: 'loan_repayment',
        title: `Loan repayment — ${row.member?.name || 'Member'}`,
        subtitle: 'Pending Cashier confirmation',
        amount: row.amount,
        status: row.status,
        priority: 'normal',
        createdAt: row.createdAt,
        entityId: row._id,
        actions: [
          {
            key: 'approve',
            label: 'Accept',
            method: 'PATCH',
            path: `/api/loans/admin/repayments/${row._id}`,
            body: { status: 'approved' },
            requiresPassword: true,
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'PATCH',
            path: `/api/loans/admin/repayments/${row._id}`,
            body: { status: 'rejected' },
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'staff', hash: '#loans' },
      }));
    }
  }

  // CEO: approve/reject pending member refund requests.
  if (userHasPermission(user, 'can_manage_refunds') && !isCashier) {
    const pendingRefunds = await Refund.find({ status: 'pending' })
      .populate('member', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const refund of pendingRefunds) {
      items.push(item({
        id: `refund:${refund._id}`,
        type: 'refund',
        title: `Refund request — ${refund.member?.name || 'Member'}`,
        subtitle: refund.reason
          ? `Awaiting CEO approval · ${refund.reason}`
          : 'Awaiting CEO approval',
        amount: refund.amount,
        status: refund.status,
        priority: 'high',
        createdAt: refund.createdAt,
        entityId: refund._id,
        actions: [
          {
            key: 'approve',
            label: 'Approve',
            method: 'POST',
            path: `/api/admin/refunds/${refund._id}/approve`,
            body: { adminNote: 'Approved from Approvals inbox' },
            requiresPassword: true,
          },
          {
            key: 'reject',
            label: 'Reject',
            method: 'POST',
            path: `/api/admin/refunds/${refund._id}/reject`,
            body: { adminNote: 'Rejected from Approvals inbox' },
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'admin', hash: '#approvals' },
      }));
    }
  }

  // Cashier: payout only after CEO approval.
  if (userHasPermission(user, 'can_disburse_refunds') && isCashier) {
    const approvedRefunds = await Refund.find({ status: { $in: ['approved', 'processing'] } })
      .populate('member', 'name email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const refund of approvedRefunds) {
      items.push(item({
        id: `refund_payout:${refund._id}`,
        type: 'refund',
        title: `Refund payout — ${refund.member?.name || 'Member'}`,
        subtitle: 'CEO approved — ready for Cashier disbursement',
        amount: refund.amount,
        status: refund.status === 'processing' ? 'approved' : refund.status,
        priority: 'high',
        createdAt: refund.createdAt,
        entityId: refund._id,
        actions: [
          {
            key: 'complete',
            label: 'Pay from bank',
            method: 'POST',
            path: `/api/admin/refunds/${refund._id}/cashier-complete`,
            body: { paymentMethod: 'cash', adminNote: 'Paid from Approvals inbox' },
            requiresPassword: true,
          },
        ],
        deepLink: { dashboard: 'staff', hash: '#refunds' },
      }));
    }
  }

  return items;
}

async function getApprovalsInbox(user) {
  if (!user) {
    const error = new Error('Authentication required.');
    error.status = 401;
    throw error;
  }

  const role = normalizeRole(user.role);
  let items = [];

  if (role === 'member') {
    items = await collectMemberItems(user);
  } else {
    items = await collectStaffItems(user);
  }

  // De-dupe by id (e.g. investment monitor vs cashier payment for same entity on dual-role views)
  const seen = new Set();
  items = items.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  items.sort((a, b) => {
    const priorityRank = { high: 0, normal: 1, low: 2 };
    const pa = priorityRank[a.priority] ?? 1;
    const pb = priorityRank[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const byType = items.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] || 0) + 1;
    return acc;
  }, {});

  return {
    summary: {
      total: items.length,
      highPriority: items.filter((row) => row.priority === 'high').length,
      byType,
    },
    items,
  };
}

async function getApprovalsCounts(user) {
  const inbox = await getApprovalsInbox(user);
  return {
    total: inbox.summary.total,
    highPriority: inbox.summary.highPriority,
    byType: inbox.summary.byType,
  };
}

module.exports = {
  getApprovalsInbox,
  getApprovalsCounts,
};
