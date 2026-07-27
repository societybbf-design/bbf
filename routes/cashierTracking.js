const router = require('express').Router();
const { requireCashierTrackingRead } = require('../middleware/cashierTrackingAccess');
const {
  getTransparencySummary,
  getTransparencyLedger,
  getTransparencyAudit,
  PUBLIC_CATEGORIES,
} = require('../services/cashierTrackingService');

router.use(requireCashierTrackingRead);

router.get('/summary', async (req, res) => {
  try {
    const summary = await getTransparencySummary();
    return res.json(summary);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load cashier summary.' });
  }
});

router.get('/ledger', async (req, res) => {
  try {
    const data = await getTransparencyLedger({ limit: Number(req.query.limit) || 40 });
    return res.json(data);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load society ledger.' });
  }
});

router.get('/categories', (req, res) => {
  res.json({ categories: PUBLIC_CATEGORIES });
});

router.get('/audit', async (req, res) => {
  try {
    const data = await getTransparencyAudit({
      from: req.query.from,
      to: req.query.to,
      category: req.query.category || 'all',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(data);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load transaction log.' });
  }
});

module.exports = router;
