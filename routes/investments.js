const router = require('express').Router();
const Investment = require('../models/Investment');
const {
  approveInvestmentByMember,
  completeCashierPayment,
  createSocietyInvestment,
  deleteInvestment,
  getGroupedSocietyInvestments,
  getInvestmentApprovalDetails,
  getInvestmentSummary,
  getInvestorPortfolio,
  getProjectManagerPortfolio,
  listCashierPaymentQueue,
  listInvestorPortfolios,
  listInvestorUsers,
  listProjectManagers,
  updateInvestment,
} = require('../services/investmentService');
const {
  listInvestmentTypes,
  createInvestmentType,
  ensureDefaultInvestmentTypes,
} = require('../services/investmentTypeService');
const { generateInvestmentReceiptPdf, generatePayoutVoucherPdf } = require('../services/notificationService');
const { saveUploadedFiles } = require('../middleware/upload');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth);

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
    const portfolio = await getProjectManagerPortfolio(req.params.managerId);
    return res.json(portfolio);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load project manager portfolio.' });
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

router.get('/cashier-queue', requirePermission('can_manage_deposits', 'can_manage_investments'), async (req, res) => {
  try {
    const queue = await listCashierPaymentQueue();
    return res.json({ queue });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load cashier payment queue.' });
  }
});

router.post('/:id/cashier-complete', requirePermission('can_manage_deposits', 'can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
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
    return res.status(error.status || 500).json({ error: error.message || 'Unable to complete cashier payment.' });
  }
});

router.get('/:id/payout-voucher.pdf', requirePermission('can_manage_deposits', 'can_manage_investments'), async (req, res) => {
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

router.get('/:id/approvals', requirePermission('can_manage_investments'), async (req, res) => {
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
    const [grouped, summary] = await Promise.all([
      getGroupedSocietyInvestments(),
      getInvestmentSummary(),
    ]);

    const pendingWithTracking = [];
    for (const item of grouped.pending) {
      const details = await getInvestmentApprovalDetails(item._id);
      pendingWithTracking.push({
        ...item,
        approvalTracking: details.approvalTracking,
      });
    }

    res.json({
      investments: grouped.all,
      activeInvestments: grouped.active,
      soldInvestments: grouped.sold,
      pendingInvestments: pendingWithTracking,
      pendingMemberApproval: grouped.pendingMemberApproval,
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

router.post('/', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
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
      notes,
      documents,
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
      notes,
      documents: savedDocuments,
      createdBy: req.session?.user?.name || 'Admin',
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save investment.' });
  }
});

router.put('/:id', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
  try {
    const investment = await updateInvestment(req.params.id, req.body);
    return res.json({ investment });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update investment.' });
  }
});

router.delete('/:id', requirePermission('can_manage_investments'), requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await deleteInvestment(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to delete investment.' });
  }
});

module.exports = router;
