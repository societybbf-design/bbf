const router = require('express').Router();
const Investment = require('../models/Investment');
const {
  approveInvestmentByMember,
  authorizeInvestmentByCeo,
  completeCashierPayment,
  previewCashierPayment,
  coverCashierPaymentShortfallFromAdvance,
  coverCashierPaymentShortfallFromReserve,
  createSocietyInvestment,
  proposeCapitalExpansion,
  deleteInvestment,
  getGroupedSocietyInvestments,
  getInvestmentApprovalDetails,
  getInvestmentSummary,
  buildInvestmentSummaryFromGrouped,
  buildApprovalTracking,
  buildApprovalTrackingBatch,
  getSavingsPool,
  getInvestorPortfolio,
  getExternalInvestorPortfolio,
  getProjectManagerPortfolio,
  listCashierPaymentQueue,
  listInvestorPortfolios,
  listInvestorUsers,
  listExternalInvestorUsers,
  listProjectManagers,
  updateInvestment,
  ceoConfirmExternalFundRelease,
} = require('../services/investmentService');
const {
  creditWalletDeposit,
  getWalletSnapshot,
} = require('../services/externalInvestorWalletService');
const {
  getAssignedProjectsWorkspace,
  createProjectExpense,
  submitProjectExpense,
  ceoReviewProjectExpense,
  listProjectExpenses,
  createOrSubmitMonthlyReport,
  ceoReviewMonthlyReport,
  listPendingCeoProjectOps,
} = require('../services/projectOpsService');
const { getExternalLedgerForInvestment } = require('../services/externalInvestorLedgerService');
const { requireAuth, requirePermission, requirePasswordConfirmation, requireCeo } = require('../middleware/auth');
const {
  listInvestmentTypes,
  createInvestmentType,
  ensureDefaultInvestmentTypes,
} = require('../services/investmentTypeService');
const {
  recordExternalInvestment,
  recordCeoExternalInvestorDeposit,
  recordMonthlyProjectReturn,
  liquidateProject,
  listExternalCapitalQueue,
  listActiveMonthlyProjects,
} = require('../services/projectFinanceService');
const {
  ceoExecuteExternalPayout,
} = require('../services/externalInvestorPortalService');
const { generateInvestmentReceiptPdf, generatePayoutVoucherPdf } = require('../services/notificationService');
const { saveUploadedFiles } = require('../middleware/upload');

router.use(requireAuth);

/** Hard role gate for cashier payout / funding actions (never Project Manager). */
function requireCashierRole(req, res, next) {
  if (req.session?.user?.role === 'cashier') {
    return next();
  }
  return res.status(403).json({
    error: 'Only the Cashier can process investment payouts and cashier funding actions.',
  });
}

const cashierDepositPerm = requirePermission('can_manage_deposits');
const cashierMoney = [cashierDepositPerm, requireCashierRole];

router.get('/preview-code', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const { generateInvestmentCode } = require('../services/investmentService');
    const investmentCode = await generateInvestmentCode();
    return res.json({ investmentCode });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate investment code preview.' });
  }
});

router.get('/types', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const types = await listInvestmentTypes();
    return res.json({ types });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investment types.' });
  }
});

router.post('/types', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const type = await createInvestmentType(req.body);
    return res.status(201).json({ type });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to create investment type.' });
  }
});

router.get('/investors', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const investors = await listInvestorUsers();
    return res.json({ investors });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investors.' });
  }
});

/** External co-funders only — used by Create Project ownership dropdown + CEO module. */
router.get('/external-investors', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const investors = await listExternalInvestorUsers();
    return res.json({ investors });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load external investors.' });
  }
});

/** CEO External Investor Management — ledgers, deposits, returns, project shares. */
router.get('/external-investors/:investorId/portfolio', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const portfolio = await getExternalInvestorPortfolio(req.params.investorId);
    return res.json(portfolio);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load external investor portfolio.',
    });
  }
});

/**
 * CEO records physical cash deposit for an External Investor.
 * - No investmentId → credits unallocated wallet (required before joint project create)
 * - With investmentId → legacy per-project stake deposit
 */
router.post(
  '/external-investors/:investorId/deposits',
  requireCeo,
  requirePasswordConfirmation,
  async (req, res) => {
    try {
      const investmentId = req.body?.investmentId || req.body?.projectId || '';
      const recordedBy = req.session?.user?.name || 'CEO';
      if (!investmentId || investmentId === 'wallet') {
        const result = await creditWalletDeposit({
          investorId: req.params.investorId,
          amount: req.body?.amount,
          note: req.body?.note || '',
          recordedBy,
        });
        return res.status(201).json(result);
      }
      const result = await recordCeoExternalInvestorDeposit({
        investorId: req.params.investorId,
        investmentId,
        amount: req.body?.amount,
        note: req.body?.note || '',
        recordedBy,
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Unable to record external investor deposit.',
      });
    }
  }
);

router.get('/external-investors/:investorId/wallet', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const wallet = await getWalletSnapshot(req.params.investorId);
    return res.json({ wallet });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load external investor wallet.',
    });
  }
});

/** CEO confirms fund release after External Investor project approval — locks wallet capital. */
router.post(
  '/:id/external-fund-release',
  requireCeo,
  requirePasswordConfirmation,
  async (req, res) => {
    try {
      const result = await ceoConfirmExternalFundRelease(req.params.id, {
        confirmedBy: req.session?.user?.name || 'CEO',
        note: req.body?.note || '',
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Unable to confirm external fund release.',
      });
    }
  }
);

/** CEO executes External Investor–approved payout from that investor’s ledger. */
router.post(
  '/external-payouts/:requestId/execute',
  requireCeo,
  requirePasswordConfirmation,
  async (req, res) => {
    try {
      const result = await ceoExecuteExternalPayout(req.params.requestId, {
        executedBy: req.session?.user?.name || 'CEO',
        note: req.body?.note || '',
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Unable to execute external payout.',
      });
    }
  }
);

router.get('/project-managers', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const projectManagers = await listProjectManagers();
    return res.json({ projectManagers });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load project managers.' });
  }
});

router.get('/project-managers/:managerId/portfolio', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const actor = req.session.user;
    // Project Managers may only load their own assigned portfolio.
    if (
      actor.role === 'project_manager'
      && String(req.params.managerId) !== String(actor.id || actor._id)
    ) {
      return res.status(403).json({ error: 'Project Managers can only view their own assigned projects.' });
    }
    const portfolio = await getProjectManagerPortfolio(req.params.managerId);
    return res.json(portfolio);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load project manager portfolio.' });
  }
});

/** Project Manager workspace — assigned projects, stakeholders, expenses, P&L, activity. */
router.get('/pm/workspace', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    if (req.session.user.role !== 'project_manager'
      && req.session.user.role !== 'ceo'
      && req.session.user.role !== 'admin'
      && req.session.user.role !== 'developer') {
      return res.status(403).json({ error: 'Project Manager workspace only.' });
    }
    const user = req.session.user.role === 'project_manager'
      ? req.session.user
      : {
        ...req.session.user,
        id: req.query.managerId || req.session.user.id,
        role: 'project_manager',
      };
    // CEO preview requires explicit managerId; PM always uses self.
    if (req.session.user.role === 'project_manager') {
      const workspace = await getAssignedProjectsWorkspace(req.session.user);
      return res.json(workspace);
    }
    if (!req.query.managerId) {
      return res.status(400).json({ error: 'managerId is required for CEO preview.' });
    }
    const workspace = await getAssignedProjectsWorkspace({
      id: req.query.managerId,
      role: 'project_manager',
      name: req.session.user.name,
    });
    return res.json(workspace);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load PM workspace.' });
  }
});

router.get('/:id/external-ledger', requirePermission('can_manage_investments', 'can_manage_deposits'), async (req, res) => {
  try {
    const payload = await getExternalLedgerForInvestment(req.params.id);
    return res.json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load external ledger.' });
  }
});

router.get('/:id/expenses', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const result = await listProjectExpenses(req.params.id, req.session.user);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load expenses.' });
  }
});

router.post('/:id/expenses', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await createProjectExpense({
      investmentId: req.params.id,
      user: req.session.user,
      description: req.body?.description,
      amount: req.body?.amount,
      expenseDate: req.body?.expenseDate,
      category: req.body?.category,
      documents: req.body?.documents || [],
      submit: Boolean(req.body?.submit),
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save expense.' });
  }
});

router.post('/expenses/:expenseId/submit', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await submitProjectExpense(req.params.expenseId, req.session.user);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to submit expense.' });
  }
});

router.post('/expenses/:expenseId/ceo-review', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    // Default society bank debit ON when approving (callers may pass false to skip).
    const executeSocietyDebit = req.body?.executeSocietyDebit === false
      || req.body?.executeSocietyDebit === 'false'
      ? false
      : true;
    const result = await ceoReviewProjectExpense(req.params.expenseId, {
      approve: req.body?.approve !== false && req.body?.approved !== false,
      note: req.body?.note || '',
      reviewedBy: req.session.user.name || 'CEO',
      executeSocietyDebit,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to review expense.' });
  }
});

router.post('/:id/monthly-report', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await createOrSubmitMonthlyReport({
      investmentId: req.params.id,
      user: req.session.user,
      yearMonth: req.body?.yearMonth,
      grossRevenue: req.body?.grossRevenue ?? req.body?.revenue,
      notes: req.body?.notes || '',
      submit: req.body?.submit !== false,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save monthly report.' });
  }
});

router.post('/monthly-reports/:reportId/ceo-review', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await ceoReviewMonthlyReport(req.params.reportId, {
      approve: req.body?.approve !== false && req.body?.approved !== false,
      note: req.body?.note || '',
      reviewedBy: req.session.user.name || 'CEO',
      markExternalPaid: Boolean(req.body?.markExternalPaid),
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to review monthly report.' });
  }
});

router.get('/ceo/pending-ops', requireCeo, async (req, res) => {
  try {
    const result = await listPendingCeoProjectOps();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load pending project operations.' });
  }
});

/** CEO final authorization after member approvals (projects + capital expansions). */
router.post('/:id/ceo-authorize', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await authorizeInvestmentByCeo(req.params.id, {
      approved: req.body?.approve !== false && req.body?.approved !== false,
      note: req.body?.note || '',
      authorizedBy: req.session.user.name || 'CEO',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to authorize investment.' });
  }
});

router.get('/portfolios', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const portfolios = await listInvestorPortfolios();
    return res.json({ portfolios });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investor portfolios.' });
  }
});

router.get('/portfolio/:investorId', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const portfolio = await getInvestorPortfolio(req.params.investorId);
    return res.json(portfolio);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load investor portfolio.' });
  }
});

router.get('/cashier-queue', ...cashierMoney, async (req, res) => {
  try {
    const queue = await listCashierPaymentQueue();
    return res.json({ queue });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load cashier payment queue.' });
  }
});

router.get('/external-capital-queue', ...cashierMoney, async (req, res) => {
  try {
    const queue = await listExternalCapitalQueue();
    return res.json({ queue });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load external capital queue.' });
  }
});

router.get('/monthly-projects', requirePermission('can_manage_deposits', 'can_manage_profit'), async (req, res) => {
  try {
    const projects = await listActiveMonthlyProjects();
    return res.json({ projects });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load monthly projects.' });
  }
});

router.post('/:id/external-capital', requirePermission('can_manage_deposits'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await recordExternalInvestment({
      investmentId: req.params.id,
      amount: req.body?.amount,
      note: req.body?.note,
      paymentChannel: req.body?.paymentChannel,
      paymentReference: req.body?.paymentReference,
      recordedBy: req.session?.user?.name || 'Cashier',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record external investment.' });
  }
});

router.post('/:id/monthly-return', requirePermission('can_manage_deposits', 'can_manage_profit'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await recordMonthlyProjectReturn({
      investmentId: req.params.id,
      profitAmount: req.body?.profitAmount || req.body?.amount,
      externalExtraExpenses: req.body?.externalExtraExpenses || req.body?.externalExpenses || 0,
      notes: req.body?.notes,
      recordedBy: req.session?.user?.name || 'Cashier',
      yearMonth: req.body?.yearMonth || null,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record monthly return.' });
  }
});

// Project sale/liquidation is a financial settlement action — require profit permission
// (CEO + cashier). Project managers with investments-only access cannot sell projects.
router.post('/:id/liquidate', requirePermission('can_manage_profit'), requirePasswordConfirmation, async (req, res) => {
  const {
    beginProfitCloseIdempotency,
    completeProfitCloseIdempotency,
    failProfitCloseIdempotency,
  } = require('../services/profitCloseIdempotencyService');

  const rawKey = req.get?.('Idempotency-Key')
    || req.headers?.['idempotency-key']
    || req.body?.clientRequestId
    || '';
  let claim;
  try {
    claim = await beginProfitCloseIdempotency(rawKey, {
      actorId: req.session?.user?.id || req.session?.user?._id || '',
      investmentCode: String(req.params.id || ''),
      amount: Number(req.body?.saleAmount) || 0,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid idempotency key.' });
  }

  if (claim.kind === 'replay') {
    return res.status(claim.status || 200).json({ ...claim.body, idempotentReplay: true });
  }

  try {
    const result = await liquidateProject({
      investmentId: req.params.id,
      saleAmount: req.body?.saleAmount,
      additionalCosts: req.body?.additionalCosts,
      tax: req.body?.tax,
      externalExtraExpenses: req.body?.externalExtraExpenses || req.body?.externalExpenses || 0,
      notes: req.body?.notes,
      productName: req.body?.productName,
      recordedBy: req.session?.user?.name || 'Admin',
    });
    const body = {
      ...result,
      sale: result.sale,
      bookBalance: result.bankLedger?.ledger?.bookBalance ?? null,
      idempotentReplay: false,
    };
    await completeProfitCloseIdempotency(claim.key, 200, body);
    return res.json(body);
  } catch (error) {
    await failProfitCloseIdempotency(claim.key);
    return res.status(error.status || 500).json({ error: error.message || 'Unable to liquidate project.' });
  }
});

router.get('/:id/cashier-payment-check', ...cashierMoney, async (req, res) => {
  try {
    const result = await previewCashierPayment(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to check payment funding.' });
  }
});

router.post('/:id/cashier-cover-advance', ...cashierMoney, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await coverCashierPaymentShortfallFromAdvance({
      investmentId: req.params.id,
      lenderId: req.body?.lenderId || req.body?.memberId,
      borrowerId: req.body?.borrowerId || req.body?.shortMemberId || null,
      amount: req.body?.amount,
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to cover shortfall from advance.',
      code: error.code || null,
      funding: error.funding || null,
    });
  }
});

router.post('/:id/cashier-cover-reserve', ...cashierMoney, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await coverCashierPaymentShortfallFromReserve({
      investmentId: req.params.id,
      memberId: req.body?.memberId || req.body?.borrowerId || req.body?.shortMemberId || null,
      amount: req.body?.amount,
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to cover shortfall from reserve.',
      code: error.code || null,
      funding: error.funding || null,
    });
  }
});

router.post('/:id/cashier-complete', ...cashierMoney, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await completeCashierPayment(req.params.id, {
      cashierName: req.session?.user?.name || 'Cashier',
      note: req.body?.note || '',
      payoutReceiverRole: req.body?.payoutReceiverRole,
      payoutReceiverName: req.body?.payoutReceiverName,
      payoutReceiverEmail: req.body?.payoutReceiverEmail,
      payoutAccountName: req.body?.payoutAccountName,
      payoutAccountNumber: req.body?.payoutAccountNumber,
      payoutBankName: req.body?.payoutBankName,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to complete cashier payment.',
      code: error.code || null,
      funding: error.funding || null,
    });
  }
});

router.get('/:id/payout-voucher.pdf', ...cashierMoney, async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id);
    if (!investment || !investment.cashierProcessedAt) {
      return res.status(404).json({ error: 'Payout voucher not available.' });
    }
    let entry = null;
    if (investment.bankLedgerEntryId) {
      const { getEntryById } = require('../services/bankLedgerService');
      try {
        entry = await getEntryById(investment.bankLedgerEntryId);
      } catch {
        entry = null;
      }
    }
    const pdfBuffer = await generatePayoutVoucherPdf(
      investment,
      entry,
      req.session?.user?.name || investment.cashierProcessedBy || 'Cashier'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payout-${investment.investmentCode || investment._id}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate payout voucher.' });
  }
});

router.get('/:id/approvals', requirePermission('can_manage_investments', 'can_manage_deposits'), async (req, res) => {
  try {
    const details = await getInvestmentApprovalDetails(req.params.id);
    return res.json(details);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load approval tracking.' });
  }
});

router.get('/lookup/:code', requirePermission('can_manage_investments', 'can_manage_profit'), async (req, res) => {
  try {
    const { lookupInvestmentForProfit } = require('../services/profitService');
    const investment = await lookupInvestmentForProfit(req.params.code);
    return res.json({ investment });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Investment not found.' });
  }
});

router.get('/summary', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const summary = await getInvestmentSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load investment summary.' });
  }
});

router.get('/', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    await ensureDefaultInvestmentTypes();

    // Project Managers only see projects assigned to them.
    if (req.session.user.role === 'project_manager') {
      const workspace = await getAssignedProjectsWorkspace(req.session.user);
      return res.json({
        investments: workspace.investments || [],
        activeInvestments: workspace.activeInvestments || [],
        soldInvestments: workspace.soldInvestments || [],
        pendingInvestments: workspace.pendingInvestments || [],
        pendingMemberApproval: (workspace.pendingInvestments || []).filter((i) => i.status === 'pending_member_approval'),
        pendingCeoAuthorization: (workspace.pendingInvestments || []).filter((i) => i.status === 'pending_ceo_authorization'),
        pendingCashierPayment: (workspace.pendingInvestments || []).filter((i) => i.status === 'pending_cashier_payment'),
        summary: workspace.summary,
        projects: workspace.projects,
        activity: workspace.activity,
        scopedToProjectManager: true,
      });
    }

    const grouped = await getGroupedSocietyInvestments();
    const { totalSavings } = await getSavingsPool();
    const summary = buildInvestmentSummaryFromGrouped(grouped, totalSavings);

    const pendingWithTracking = await buildApprovalTrackingBatch(grouped.pending || []);

    res.json({
      investments: grouped.all,
      activeInvestments: grouped.active,
      soldInvestments: grouped.sold,
      pendingInvestments: pendingWithTracking,
      pendingMemberApproval: grouped.pendingMemberApproval,
      pendingCeoAuthorization: grouped.pendingCeoAuthorization || [],
      pendingCashierPayment: grouped.pendingCashierPayment,
      summary,
    });
  } catch (error) {
    console.error('Unable to load investments:', error);
    res.status(500).json({ error: error.message || 'Unable to load investment records.' });
  }
});

router.get('/:id/receipt', requirePermission('can_manage_investments'), async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id)
      .populate('investor', 'name email')
      .populate('projectManager', 'name email');
    if (!investment) {
      return res.status(404).json({ error: 'Investment receipt not found.' });
    }

    const pdfBuffer = await generateInvestmentReceiptPdf(
      investment,
      req.session?.user?.name || 'Admin'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="investment-${investment._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate investment receipt.' });
  }
});

router.post('/', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const {
      amount,
      investorId,
      investmentType,
      projectManagerId,
      investorName,
      dateOfBirth,
      location,
      sector,
      partner,
      projectAssetCategory,
      projectAsset,
      notes,
      documents,
      returnMode,
      termMonths,
      maturityDate,
      societyOwnershipPct,
      investorOwnershipPct,
      societyAmount,
      externalAmount,
      externalInvestors,
    } = req.body;

    const savedDocuments = saveUploadedFiles(documents || [], 'investments');

    const result = await createSocietyInvestment({
      amount,
      investorId,
      investmentType,
      projectManagerId,
      investorName: investorName || partner,
      dateOfBirth,
      location: location || sector,
      sector,
      partner,
      projectAssetCategory,
      projectAsset: projectAsset || req.body?.projectAssetName || req.body?.assetName || '',
      notes,
      documents: savedDocuments,
      createdBy: req.session?.user?.name || 'Admin',
      returnMode,
      termMonths,
      maturityDate,
      societyOwnershipPct,
      investorOwnershipPct,
      societyAmount,
      externalAmount,
      externalInvestors,
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save investment.' });
  }
});

/** CEO: propose capital expansion on a running project → member approval → existing cashier queue. */
router.post('/:id/expand-capital', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await proposeCapitalExpansion({
      parentInvestmentId: req.params.id,
      expansionAmount: req.body?.expansionAmount ?? req.body?.amount,
      notes: req.body?.notes || '',
      createdBy: req.session?.user?.name || 'CEO',
      societyOwnershipPct: req.body?.societyOwnershipPct,
      investorOwnershipPct: req.body?.investorOwnershipPct,
      societyAmount: req.body?.societyAmount,
      externalAmount: req.body?.externalAmount,
      externalInvestors: req.body?.externalInvestors,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to propose capital expansion.',
    });
  }
});

router.put('/:id', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const investment = await updateInvestment(req.params.id, req.body);
    return res.json({ investment });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update investment.' });
  }
});

router.delete('/:id', requireCeo, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await deleteInvestment(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to delete investment.' });
  }
});

module.exports = router;
