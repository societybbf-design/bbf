const { formatMoney } = require('../services/moneyFormat');
const router = require('express').Router();
const {
  getTargetForMonth,
  getActiveMonthTarget,
  listTargets,
  listTargetsForYear,
  bulkUpsertTargets,
  upsertTarget,
  syncMonthDues,
  listUnpaidMonthlyDues,
  yearMonthFromDate,
} = require('../services/monthlyTargetService');
const { getMonthlyContributionReport } = require('../services/monthlyContributionService');
const { runMonthlyAutoDeductions } = require('../services/monthlyAutoDeductionService');
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
    const includeAll = String(req.query.includePaid || '') === '1';
    const dues = await listUnpaidMonthlyDues({ yearMonth, includeAll });
    const target = await getTargetForMonth(yearMonth);
    return res.json({ yearMonth, target, dues });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load unpaid monthly dues.' });
  }
});

router.get('/year/:year', async (req, res) => {
  try {
    const plan = await listTargetsForYear(req.params.year);
    const active = await getActiveMonthTarget();
    return res.json({ ...plan, active });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load year plan.' });
  }
});

router.put('/year/:year/bulk', writeTargets, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await bulkUpsertTargets({
      year: req.params.year,
      months: req.body?.months || [],
      setBy: req.session?.user?.name || 'Admin',
      syncDues: req.body?.syncDues !== false,
    });
    return res.json({
      ...result,
      message: `Saved ${result.count} month target(s) for ${result.year}. `
        + 'Each saved month’s fixed amount was propagated to all active member dues.',
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save year plan.' });
  }
});

router.post('/run-auto-deduction', writeTargets, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await runMonthlyAutoDeductions({
      asOf: req.body?.asOf ? new Date(req.body.asOf) : new Date(),
      dryRun: Boolean(req.body?.dryRun),
    });
    return res.json({
      ...result,
      message: result.skipped
        ? `Auto-deduction skipped: ${result.reason || 'no action'}.`
        : `Processed ${result.processed} member(s); ${result.applied} auto-deducted.`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to run auto-deduction.' });
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
    const sync = result.duesSync;
    const syncNote = sync?.skipped
      ? ` Dues sync skipped: ${sync.reason || 'no target'}.`
      : (sync
        ? ` Propagated to ${sync.synced} active member(s) (${sync.created} new due row(s), ${sync.updated} updated).`
        : '');
    return res.json({
      ...result,
      message: `Fixed target for ${result.target.monthLabel} set to ${formatMoney(Number(result.target.amount), 2)}.${syncNote}`,
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
