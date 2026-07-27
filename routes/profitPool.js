const router = require('express').Router();
const ProfitDistribution = require('../models/ProfitDistribution');
const {
  getPool,
  logMonthlyProfit,
  distributeEqually,
} = require('../services/profitPoolService');
const { generateProfitDistributionPdf } = require('../services/notificationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_profit', 'can_manage_deposits'));

router.get('/', async (req, res) => {
  try {
    const pool = await getPool({ entryLimit: Number(req.query.limit) || 30 });
    return res.json(pool);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load profit pool.' });
  }
});

router.post('/monthly', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await logMonthlyProfit({
      amount: req.body?.amount,
      note: req.body?.note || '',
      source: req.body?.source || '',
      createdBy: req.session?.user?.name || 'Cashier',
      creditBankLedger: req.body?.creditBankLedger !== false,
    });
    let message = `Monthly profit logged and credited to the bank ledger.`;
    if (result.bookBalance != null) {
      message += ` Book balance now $${Number(result.bookBalance).toFixed(2)}.`;
    }
    if (result.ledgerWarning) {
      message += ` Ledger warning: ${result.ledgerWarning}`;
    }
    return res.status(201).json({ ...result, message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to log monthly profit.' });
  }
});

router.post('/distribute', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await distributeEqually({
      amount: req.body?.amount,
      note: req.body?.note || '',
      distributedBy: req.session?.user?.name || 'Cashier',
      debitBankLedger: req.body?.debitBankLedger !== false,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to distribute profit pool.' });
  }
});

router.get('/distributions/:id/report.pdf', async (req, res) => {
  try {
    const distribution = await ProfitDistribution.findById(req.params.id);
    if (!distribution) {
      return res.status(404).json({ error: 'Distribution not found.' });
    }
    const pdfBuffer = await generateProfitDistributionPdf(distribution);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="profit-distribution-${distribution._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate distribution report.' });
  }
});

module.exports = router;
