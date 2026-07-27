const router = require('express').Router();
const {
  getTargetForMonth,
  getActiveMonthTarget,
  listTargets,
  upsertTarget,
  syncMonthDues,
  listUnpaidMonthlyDues,
  yearMonthFromDate,
} = require('../services/monthlyTargetService');
const { getMonthlyContributionReport } = require('../services/monthlyContributionService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits', 'can_manage_members', 'can_view_reports'));
const writeTargets = requirePermission('can_manage_deposits', 'can_manage_members');

router.get('/', async (req, res) => {
  try {
    const [targets, active] = await Promise.all([
      listTargets({ limit: Number(req.query.limit) || 24 }),
      getActiveMonthTarget(),
    ]);
    return res.json({ targets, active });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to list monthly targets.' });
  }
});

router.get('/active', async (req, res) => {
  try {
    const target = await getActiveMonthTarget();
    return res.json({ target });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load active month target.' });
  }
});

router.get('/contribution-report', async (req, res) => {
  try {
    const report = await getMonthlyContributionReport();
    return res.json(report);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load contribution report.' });
  }
});

router.get('/unpaid', async (req, res) => {
  try {
    const yearMonth = req.query.yearMonth || yearMonthFromDate();
    const dues = await listUnpaidMonthlyDues({ yearMonth });
    const target = await getTargetForMonth(yearMonth);
    return res.json({ yearMonth, target, dues });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load unpaid monthly dues.' });
  }
});

router.get('/:yearMonth', async (req, res) => {
  try {
    const target = await getTargetForMonth(req.params.yearMonth);
    return res.json({ target });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load month target.' });
  }
});

router.put('/:yearMonth', writeTargets, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await upsertTarget({
      yearMonth: req.params.yearMonth,
      amount: req.body?.amount,
      notes: req.body?.notes || '',
      setBy: req.session?.user?.name || 'Admin',
      syncDues: req.body?.syncDues !== false,
    });
    return res.json({
      ...result,
      message: `Fixed target for ${result.target.monthLabel} set to $${Number(result.target.amount).toFixed(2)}. Member dues synced.`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save month target.' });
  }
});

router.post('/:yearMonth/sync-dues', writeTargets, requirePasswordConfirmation, async (req, res) => {
  try {
    const duesSync = await syncMonthDues(req.params.yearMonth);
    return res.json({ duesSync, message: 'Monthly dues synced for active members.' });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to sync monthly dues.' });
  }
});

module.exports = router;
