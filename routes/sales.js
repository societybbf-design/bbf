const { formatMoney } = require('../services/moneyFormat');
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
// Writing a sale settles capital / P&L — profit permission required (not investments-only).
const writeSales = requirePermission('can_manage_profit');

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
      investmentCode: String(req.body?.investmentCode || ''),
      amount: Number(req.body?.saleAmount) || 0,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid idempotency key.' });
  }
  if (claim.kind === 'replay') {
    return res.status(claim.status || 201).json({ ...claim.body, idempotentReplay: true });
  }

  try {
    const result = await createSale({
      investmentCode: req.body?.investmentCode,
      productName: req.body?.productName,
      saleAmount: req.body?.saleAmount,
      additionalCosts: req.body?.additionalCosts,
      tax: req.body?.tax,
      notes: req.body?.notes,
      recordedBy: req.session?.user?.name || 'Admin',
    });
    const bookBalance = result.bookBalance;
    let message = result.message
      || 'Sale settled. Proceeds credited, ownership splits applied, and ledgers locked.';
    if (bookBalance != null) {
      message += ` Book balance now ${formatMoney(Number(bookBalance), 2)}.`;
    }
    const body = {
      sale: result.sale,
      investment: result.investment,
      settlement: result.settlement,
      bankLedger: result.bankLedger,
      bookBalance,
      ledgerWarning: null,
      message,
      idempotentReplay: false,
    };
    await completeProfitCloseIdempotency(claim.key, 201, body);
    return res.status(201).json(body);
  } catch (error) {
    await failProfitCloseIdempotency(claim.key);
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record sale.' });
  }
});

module.exports = router;
