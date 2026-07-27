const router = require('express').Router();
const {
  lookupProjectInvestments,
  createSale,
  listSales,
  getSaleById,
  computeNetProfitLoss,
  money,
} = require('../services/saleService');
const { generateSaleReportPdf } = require('../services/notificationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_investments', 'can_manage_profit', 'can_view_reports'));
const writeSales = requirePermission('can_manage_investments', 'can_manage_profit');

router.get('/lookup/:investmentCode', async (req, res) => {
  try {
    const project = await lookupProjectInvestments(req.params.investmentCode);
    return res.json({ project });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load project investments.' });
  }
});

router.post('/preview', writeSales, async (req, res) => {
  try {
    const project = await lookupProjectInvestments(req.body?.investmentCode);
    const saleAmount = money(req.body?.saleAmount);
    const additionalCosts = money(req.body?.additionalCosts);
    const tax = money(req.body?.tax);
    const netProfitLoss = computeNetProfitLoss({
      saleAmount,
      totalInvestment: project.totalInvestment,
      additionalCosts,
      tax,
    });
    return res.json({
      project,
      calculation: {
        saleAmount,
        additionalCosts,
        tax,
        totalInvestment: project.totalInvestment,
        netProfitLoss,
        outcomeType: netProfitLoss > 0 ? 'profit' : netProfitLoss < 0 ? 'loss' : 'break_even',
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to preview sale.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const sales = await listSales(req.query.limit);
    return res.json({ sales });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load sales list.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const sale = await getSaleById(req.params.id);
    return res.json({ sale });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load sale.' });
  }
});

router.get('/:id/report.pdf', async (req, res) => {
  try {
    const sale = await getSaleById(req.params.id);
    const pdfBuffer = await generateSaleReportPdf(sale, req.session?.user?.name || 'Admin');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sale.saleCode || 'sale'}-report.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate sale PDF.' });
  }
});

router.post('/', writeSales, requirePasswordConfirmation, async (req, res) => {
  try {
    const { sale, bankLedger, bookBalance, ledgerWarning } = await createSale({
      investmentCode: req.body?.investmentCode,
      productName: req.body?.productName,
      saleAmount: req.body?.saleAmount,
      additionalCosts: req.body?.additionalCosts,
      tax: req.body?.tax,
      notes: req.body?.notes,
      recordedBy: req.session?.user?.name || 'Admin',
    });
    let message = `Sale recorded. Full proceeds credited to the central bank ledger.`;
    if (bookBalance != null) {
      message += ` Book balance now $${Number(bookBalance).toFixed(2)}.`;
    }
    if (ledgerWarning) {
      message += ` Ledger warning: ${ledgerWarning}`;
    }
    return res.status(201).json({
      sale,
      bankLedger,
      bookBalance,
      ledgerWarning: ledgerWarning || null,
      message,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record sale.' });
  }
});

module.exports = router;
