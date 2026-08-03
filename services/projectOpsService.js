'use strict';

const Investment = require('../models/Investment');
const ProjectExpense = require('../models/ProjectExpense');
const ProjectMonthlyReport = require('../models/ProjectMonthlyReport');
const { saveUploadedFiles } = require('../middleware/upload');
const {
  resolveProjectStakeholders,
  splitByStakeholders,
} = require('./projectFinanceService');
const {
  creditExternalProfitAccrual,
  debitExternalExpenseShare,
  debitExternalProfitPayout,
  getExternalLedgerForInvestment,
  money,
} = require('./externalInvestorLedgerService');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function yearMonthFromDate(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function assertPmOwnsProject(investmentId, user) {
  const investment = await Investment.findById(investmentId)
    .populate('investor', 'name email role')
    .populate('projectManager', 'name email role')
    .populate('externalInvestors.investor', 'name email role');
  if (!investment || investment.member) {
    throw httpError('Project not found.', 404);
  }
  const role = user?.role || '';
  if (role === 'ceo' || role === 'admin' || role === 'developer') {
    return investment;
  }
  if (role !== 'project_manager') {
    throw httpError('Only the assigned Project Manager can perform this action.', 403);
  }
  if (String(investment.projectManager?._id || investment.projectManager || '') !== String(user.id || user._id || '')) {
    throw httpError('You can only manage projects assigned to you.', 403);
  }
  return investment;
}

function serializeStakeholders(investment) {
  const stakeholders = resolveProjectStakeholders(investment);
  return {
    societyOwnershipPct: stakeholders.societyOwnershipPct,
    investorOwnershipPct: stakeholders.investorOwnershipPct,
    projectManager: investment.projectManager
      ? {
        id: investment.projectManager._id || investment.projectManager,
        name: investment.projectManager.name || '',
        email: investment.projectManager.email || '',
        role: 'project_manager',
      }
      : null,
    externalInvestors: (stakeholders.externalInvestors || []).map((row) => ({
      id: row.investor || null,
      name: row.investorName || '',
      ownershipPct: Number(row.ownershipPct || 0),
      amount: Number(row.amount || 0),
      capitalReceived: Number(row.capitalReceived || 0),
      profitBalance: Number(row.profitBalance || 0),
      role: 'external_investor',
    })),
    internalOperator: investment.investor && (investment.investor.role === 'investor' || !stakeholders.externalInvestors?.length)
      ? {
        id: investment.investor._id || investment.investor,
        name: investment.investor.name || investment.investorName || '',
        email: investment.investor.email || '',
        role: investment.investor.role || 'investor',
      }
      : null,
  };
}

async function getAssignedProjectsWorkspace(user) {
  const managerId = user.id || user._id;
  const { getProjectManagerPortfolio } = require('./investmentService');
  const portfolio = await getProjectManagerPortfolio(managerId);

  const projects = [];
  for (const inv of portfolio.investments || []) {
    const full = await Investment.findById(inv.id || inv._id)
      .populate('investor', 'name email role')
      .populate('projectManager', 'name email role')
      .populate('externalInvestors.investor', 'name email role');
    if (!full) continue;
    const expenses = await ProjectExpense.find({ investment: full._id })
      .sort({ expenseDate: -1 })
      .limit(20)
      .lean();
    const reports = await ProjectMonthlyReport.find({ investment: full._id })
      .sort({ yearMonth: -1 })
      .limit(12)
      .lean();
    const externalLedger = await getExternalLedgerForInvestment(full._id);
    projects.push({
      ...inv,
      id: full._id,
      stakeholders: serializeStakeholders(full),
      recentExpenses: expenses,
      monthlyReports: reports,
      externalLedger: externalLedger.ledger,
      externalLedgerEntries: externalLedger.entries.slice(0, 20),
    });
  }

  const activity = await buildPmActivityFeed(managerId);

  return {
    ...portfolio,
    projects,
    activity,
  };
}

async function buildPmActivityFeed(managerId) {
  const investments = await Investment.find({
    member: null,
    projectManager: managerId,
  }).select('_id investmentCode status fundingKind amount createdAt updatedAt parentInvestment').lean();

  const ids = investments.map((row) => row._id);
  const expenses = await ProjectExpense.find({ investment: { $in: ids } })
    .sort({ updatedAt: -1 })
    .limit(40)
    .lean();
  const reports = await ProjectMonthlyReport.find({ investment: { $in: ids } })
    .sort({ updatedAt: -1 })
    .limit(40)
    .lean();

  const items = [];
  for (const inv of investments) {
    items.push({
      kind: inv.fundingKind === 'capital_expansion' ? 'capital_expansion' : 'project',
      id: inv._id,
      investmentCode: inv.investmentCode,
      status: inv.status,
      amount: inv.amount,
      at: inv.updatedAt || inv.createdAt,
      title: inv.fundingKind === 'capital_expansion'
        ? `Capital expansion ${inv.investmentCode}`
        : `Project ${inv.investmentCode}`,
    });
  }
  for (const exp of expenses) {
    items.push({
      kind: 'expense',
      id: exp._id,
      investmentCode: exp.investmentCode,
      status: exp.status,
      amount: exp.amount,
      at: exp.updatedAt || exp.createdAt,
      title: `Expense: ${exp.description}`,
    });
  }
  for (const report of reports) {
    items.push({
      kind: 'monthly_report',
      id: report._id,
      investmentCode: report.investmentCode,
      status: report.status,
      amount: report.netProfit,
      at: report.updatedAt || report.createdAt,
      title: `P&L ${report.yearMonth} — ${report.investmentCode}`,
    });
  }

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, 60);
}

function buildExternalApprovals(investment, externalShare) {
  const stakes = (investment.externalInvestors || []).filter((row) => Number(row.ownershipPct) > 0 && row.investor);
  if (!stakes.length || !(externalShare > 0)) return [];
  const totalPct = stakes.reduce((sum, row) => sum + Number(row.ownershipPct || 0), 0) || 1;
  let allocated = 0;
  return stakes.map((stake, index) => {
    const isLast = index === stakes.length - 1;
    const shareAmount = isLast
      ? money(externalShare - allocated)
      : money((externalShare * Number(stake.ownershipPct || 0)) / totalPct);
    if (!isLast) allocated = money(allocated + shareAmount);
    return {
      investor: stake.investor?._id || stake.investor,
      investorName: stake.investorName || stake.investor?.name || '',
      shareAmount,
      status: 'pending',
      decidedAt: null,
      decidedBy: '',
      decisionNote: '',
    };
  }).filter((row) => row.shareAmount > 0.001 && row.investor);
}

async function notifyExternalApprovers(expense) {
  for (const row of expense.externalApprovals || []) {
    if (!row.investor || row.status !== 'pending') continue;
  }
}

async function routeExpenseAfterSubmit(expense, investment) {
  const externalShare = money(expense.externalShare);
  if (externalShare > 0.001) {
    expense.externalApprovals = buildExternalApprovals(investment, externalShare);
    if (expense.externalApprovals.length) {
      expense.status = 'pending_external_approval';
      await expense.save();
      await notifyExternalApprovers(expense);
      return {
        expense,
        message: 'Expense submitted. External Investor approval is required before CEO can disburse from the external ledger.',
      };
    }
  }

  expense.status = 'submitted';
  await expense.save();
  return { expense, message: 'Expense submitted for CEO review.' };
}

async function createProjectExpense({
  investmentId,
  user,
  description,
  amount,
  expenseDate,
  category = 'operational',
  documents = [],
  submit = false,
} = {}) {
  const investment = await assertPmOwnsProject(investmentId, user);
  if (investment.status !== 'active') {
    throw httpError('Expenses can only be logged on running (active) projects.');
  }
  const value = money(amount);
  if (!(value > 0)) throw httpError('Expense amount must be greater than zero.');
  const desc = String(description || '').trim();
  if (!desc) throw httpError('Expense description is required.');

  const stakeholders = resolveProjectStakeholders(investment);
  const split = splitByStakeholders(value, stakeholders);
  const attachments = saveUploadedFiles(documents || [], 'project-expenses');
  const when = expenseDate ? new Date(expenseDate) : new Date();

  const expense = await ProjectExpense.create({
    investment: investment._id,
    investmentCode: investment.investmentCode || '',
    projectManager: investment.projectManager?._id || investment.projectManager || user.id,
    description: desc,
    amount: value,
    expenseDate: when,
    yearMonth: yearMonthFromDate(when),
    category: String(category || 'operational').trim() || 'operational',
    attachments,
    status: 'draft',
    societyShare: split.societyShare,
    externalShare: split.investorShare,
    createdBy: user.name || 'Project Manager',
  });

  if (!submit) {
    return { expense, message: 'Expense saved as draft.' };
  }

  expense.submittedAt = new Date();
  expense.submittedBy = user.name || 'Project Manager';
  return routeExpenseAfterSubmit(expense, investment);
}

async function submitProjectExpense(expenseId, user) {
  const expense = await ProjectExpense.findById(expenseId);
  if (!expense) throw httpError('Expense not found.', 404);
  const investment = await assertPmOwnsProject(expense.investment, user);
  if (!['draft', 'ceo_rejected', 'external_rejected'].includes(expense.status)) {
    throw httpError('Only draft or rejected expenses can be submitted.');
  }
  const stakeholders = resolveProjectStakeholders(investment);
  const split = splitByStakeholders(expense.amount, stakeholders);
  expense.societyShare = split.societyShare;
  expense.externalShare = split.investorShare;
  expense.submittedAt = new Date();
  expense.submittedBy = user.name || 'Project Manager';
  return routeExpenseAfterSubmit(expense, investment);
}

async function decideExternalExpenseApproval(actor, expenseId, { approve = true, note = '' } = {}) {
  if (String(actor?.role || '').toLowerCase() !== 'external_investor') {
    throw httpError('External Investor access only.', 403);
  }
  const investorId = String(actor.id || actor._id || '');
  const expense = await ProjectExpense.findById(expenseId);
  if (!expense) throw httpError('Expense not found.', 404);
  if (expense.status !== 'pending_external_approval') {
    throw httpError(`Expense is not awaiting external approval (status: ${expense.status}).`, 409);
  }

  const approval = (expense.externalApprovals || []).find((row) => String(row.investor) === investorId);
  if (!approval) throw httpError('This expense does not require your approval.', 403);
  if (approval.status !== 'pending') {
    throw httpError(`You already ${approval.status} this expense.`, 409);
  }

  approval.status = approve ? 'approved' : 'rejected';
  approval.decidedAt = new Date();
  approval.decidedBy = String(actor.name || actor.email || investorId);
  approval.decisionNote = String(note || '').trim();

  if (!approve) {
    expense.status = 'external_rejected';
    await expense.save();
    return { expense, message: 'Expense rejected.' };
  }

  const allApproved = (expense.externalApprovals || []).every((row) => row.status === 'approved');
  if (allApproved) {
    expense.status = 'external_approved';
    await expense.save();
    return {
      expense,
      message: 'Approved. The request is now with the CEO for final disbursement from your external ledger.',
    };
  }

  await expense.save();
  return {
    expense,
    message: 'Approved. Waiting for remaining External Investors before CEO disbursement.',
  };
}

async function ceoReviewProjectExpense(expenseId, {
  approve = true,
  note = '',
  reviewedBy = 'CEO',
  executeSocietyDebit = false,
} = {}) {
  const expense = await ProjectExpense.findById(expenseId);
  if (!expense) throw httpError('Expense not found.', 404);

  const investment = await Investment.findById(expense.investment)
    .populate('externalInvestors.investor', 'name email role');
  if (!investment) throw httpError('Project not found.', 404);

  expense.ceoReviewedAt = new Date();
  expense.ceoReviewedBy = reviewedBy;
  expense.ceoNote = String(note || '').trim();

  // Society-only / legacy path.
  if (expense.status === 'submitted') {
    if (!approve) {
      expense.status = 'ceo_rejected';
      await expense.save();
      return { expense, message: 'Expense rejected by CEO.' };
    }
    if (money(expense.externalShare) > 0.001) {
      expense.externalApprovals = buildExternalApprovals(investment, expense.externalShare);
      if (expense.externalApprovals.length) {
        expense.status = 'pending_external_approval';
        await expense.save();
        await notifyExternalApprovers(expense);
        return {
          expense,
          message: 'External share present — routed to External Investor(s) for approval before disbursement.',
        };
      }
    }
    if (executeSocietyDebit && money(expense.societyShare) > 0) {
      const { debit } = require('./bankLedgerService');
      const bank = await debit({
        type: 'operational_expense',
        amount: expense.societyShare,
        referenceType: 'ProjectExpense',
        referenceId: expense._id,
        note: `Society project expense ${expense.investmentCode}: ${expense.description}`,
        createdBy: reviewedBy,
      });
      expense.societyLedgerEntryId = bank?.entry?._id || null;
      expense.status = 'executed';
    } else {
      expense.status = 'ceo_approved';
    }
    await expense.save();
    return {
      expense,
      message: executeSocietyDebit
        ? 'Expense approved; society share posted to bank ledger.'
        : 'Expense approved (society share only — no external ledger debit).',
    };
  }

  // After External Investor approval — CEO executes payment from external ledger.
  if (expense.status === 'external_approved') {
    if (!approve) {
      expense.status = 'ceo_rejected';
      await expense.save();
      return { expense, message: 'Expense rejected by CEO after external approval.' };
    }
    if (money(expense.externalShare) > 0) {
      const external = await debitExternalExpenseShare(investment, expense.externalShare, {
        note: `External expense share (CEO disbursement): ${expense.description}`,
        createdBy: reviewedBy,
        referenceType: 'ProjectExpense',
        referenceId: expense._id,
      });
      expense.externalLedgerEntryId = external.entry._id;
    }
    if (executeSocietyDebit && money(expense.societyShare) > 0) {
      const { debit } = require('./bankLedgerService');
      const bank = await debit({
        type: 'operational_expense',
        amount: expense.societyShare,
        referenceType: 'ProjectExpense',
        referenceId: expense._id,
        note: `Society project expense ${expense.investmentCode}: ${expense.description}`,
        createdBy: reviewedBy,
      });
      expense.societyLedgerEntryId = bank?.entry?._id || null;
    }
    expense.status = 'executed';
    await expense.save();
    return {
      expense,
      message: 'Disbursed from External Investor ledger'
        + (executeSocietyDebit && money(expense.societyShare) > 0 ? ' and society bank for society share.' : '.'),
    };
  }

  throw httpError(
    `Expense cannot be reviewed in status "${expense.status}". `
    + 'Await External Investor approval when an external share is involved.',
    409
  );
}

async function listExternalInvestorExpenseApprovals(investorId) {
  return ProjectExpense.find({
    status: 'pending_external_approval',
    externalApprovals: {
      $elemMatch: { investor: investorId, status: 'pending' },
    },
  })
    .sort({ submittedAt: -1 })
    .limit(50)
    .lean();
}

async function listProjectExpenses(investmentId, user) {
  await assertPmOwnsProject(investmentId, user);
  const expenses = await ProjectExpense.find({ investment: investmentId }).sort({ expenseDate: -1 }).lean();
  return { expenses };
}

async function createOrSubmitMonthlyReport({
  investmentId,
  user,
  yearMonth,
  grossRevenue,
  notes = '',
  submit = true,
} = {}) {
  const investment = await assertPmOwnsProject(investmentId, user);
  if (investment.status !== 'active') {
    throw httpError('Monthly reports can only be filed for running projects.');
  }
  const period = String(yearMonth || yearMonthFromDate()).trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw httpError('yearMonth must be YYYY-MM.');
  }
  const revenue = money(grossRevenue);
  if (revenue < 0) throw httpError('Gross revenue cannot be negative.');

  const expenses = await ProjectExpense.find({
    investment: investment._id,
    yearMonth: period,
    status: { $in: ['submitted', 'ceo_approved', 'executed', 'draft'] },
  }).lean();

  const totalExpenses = money(expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const netProfit = money(revenue - totalExpenses);
  const stakeholders = resolveProjectStakeholders(investment);
  const profitBase = Math.max(netProfit, 0);
  const split = splitByStakeholders(profitBase, stakeholders);

  let report = await ProjectMonthlyReport.findOne({ investment: investment._id, yearMonth: period });
  if (report && ['ceo_approved', 'external_payout_queued', 'executed'].includes(report.status)) {
    throw httpError('This month already has an approved or executed P&L report.', 409);
  }

  if (!report) {
    report = new ProjectMonthlyReport({
      investment: investment._id,
      investmentCode: investment.investmentCode || '',
      projectManager: investment.projectManager?._id || investment.projectManager || user.id,
      yearMonth: period,
      createdBy: user.name || 'Project Manager',
    });
  }

  report.grossRevenue = revenue;
  report.totalExpenses = totalExpenses;
  report.netProfit = netProfit;
  report.societyOwnershipPct = stakeholders.societyOwnershipPct;
  report.investorOwnershipPct = stakeholders.investorOwnershipPct;
  report.societyProfitShare = split.societyShare;
  report.investorProfitShare = split.investorShare;
  report.expenseIds = expenses.map((row) => row._id);
  report.notes = String(notes || '').trim();
  report.status = submit ? 'pending_ceo' : 'draft';
  report.submittedAt = submit ? new Date() : null;
  report.submittedBy = submit ? (user.name || 'Project Manager') : '';
  await report.save();

  return {
    report,
    expenses,
    message: submit
      ? `P&L for ${period} submitted. Net profit ${netProfit.toFixed(2)} awaiting CEO approval.`
      : `P&L draft saved for ${period}.`,
  };
}

/**
 * CEO approves monthly P&L. External profit share is queued on the isolated
 * external sub-ledger (zero society bank cash-flow overlap). Society share
 * remains for CEO/cashier profit tools to execute separately if needed.
 */
async function ceoReviewMonthlyReport(reportId, {
  approve = true,
  note = '',
  reviewedBy = 'CEO',
  markExternalPaid = false,
} = {}) {
  const report = await ProjectMonthlyReport.findById(reportId);
  if (!report) throw httpError('Monthly report not found.', 404);
  if (report.status !== 'pending_ceo') {
    throw httpError('Report is not awaiting CEO review.');
  }

  const investment = await Investment.findById(report.investment);
  if (!investment) throw httpError('Project not found.', 404);

  report.ceoReviewedAt = new Date();
  report.ceoReviewedBy = reviewedBy;
  report.ceoNote = String(note || '').trim();

  if (!approve) {
    report.status = 'ceo_rejected';
    await report.save();
    return { report, message: 'Monthly P&L rejected by CEO.' };
  }

  if (money(report.investorProfitShare) > 0) {
    const accrual = await creditExternalProfitAccrual(investment, report.investorProfitShare, {
      note: `External profit accrual ${report.yearMonth} — ${report.investmentCode}`,
      createdBy: reviewedBy,
      referenceType: 'ProjectMonthlyReport',
      referenceId: report._id,
      payoutStatus: 'approved',
    });
    report.externalLedgerEntryId = accrual.entry._id;

    if (markExternalPaid) {
      const payout = await debitExternalProfitPayout(investment, report.investorProfitShare, {
        note: `External profit payout ${report.yearMonth} — non-society channel`,
        createdBy: reviewedBy,
        referenceType: 'ProjectMonthlyReport',
        referenceId: report._id,
        payoutStatus: 'paid',
      });
      report.externalPayoutEntryId = payout.entry._id;
      report.status = 'executed';
    } else {
      report.status = 'external_payout_queued';
    }
  } else {
    report.status = 'ceo_approved';
  }

  await report.save();

  return {
    report,
    message: 'Monthly P&L approved. External returns use the non-society sub-ledger channel.',
  };
}

async function listPendingCeoProjectOps() {
  const [expenses, reports] = await Promise.all([
    ProjectExpense.find({
      status: { $in: ['submitted', 'external_approved'] },
    }).sort({ submittedAt: -1 }).limit(50).lean(),
    ProjectMonthlyReport.find({ status: 'pending_ceo' }).sort({ submittedAt: -1 }).limit(50).lean(),
  ]);
  return { expenses, reports };
}

module.exports = {
  yearMonthFromDate,
  assertPmOwnsProject,
  serializeStakeholders,
  getAssignedProjectsWorkspace,
  buildPmActivityFeed,
  createProjectExpense,
  submitProjectExpense,
  decideExternalExpenseApproval,
  ceoReviewProjectExpense,
  listProjectExpenses,
  listExternalInvestorExpenseApprovals,
  createOrSubmitMonthlyReport,
  ceoReviewMonthlyReport,
  listPendingCeoProjectOps,
};
