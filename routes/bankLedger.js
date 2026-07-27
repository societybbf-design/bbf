const router = require('express').Router();
const Investment = require('../models/Investment');
const {
  getLedger,
  setOpeningBalance,
  reconcile,
  getDailySummary,
  getEntryById,
} = require('../services/bankLedgerService');
const {
  generateZReportPdf,
  generatePayoutVoucherPdf,
} = require('../services/notificationService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits', 'can_view_reports'));
const manageDeposits = requirePermission('can_manage_deposits');

router.get('/cashier-metrics', async (req, res) => {
  try {
    const Sale = require('../models/Sale');
    const User = require('../models/User');
    const [activeProjects, investmentAgg, salesUnits, members, profitAgg, ledger] = await Promise.all([
      Investment.countDocuments({ status: 'active' }),
      Investment.aggregate([
        { $match: { status: { $in: ['active', 'sold'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Sale.countDocuments({}),
      User.countDocuments({ role: 'member', status: 'active' }),
      User.aggregate([
        { $match: { role: 'member', status: { $ne: 'deleted' } } },
        { $group: { _id: null, total: { $sum: '$profit' } } },
      ]),
      getLedger({ entryLimit: 5 }),
    ]);

    return res.json({
      activeProjects,
      totalInvestment: Number(investmentAgg[0]?.total || 0),
      profitGenerated: Number(profitAgg[0]?.total || 0),
      salesUnits,
      activeMembers: members,
      bookBalance: ledger.bookBalance,
      recentLedger: (ledger.entries || []).slice(0, 5).map((e) => ({
        type: e.type,
        direction: e.direction,
        amount: e.amount,
        note: e.note,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load cashier metrics.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const ledger = await getLedger({ entryLimit: Number(req.query.limit) || 40 });
    return res.json(ledger);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load bank ledger.' });
  }
});

router.post('/opening', manageDeposits, requirePasswordConfirmation, async (req, res) => {
  try {
    const force = Boolean(req.body?.force) && ['ceo', 'admin'].includes(req.session?.user?.role);
    const result = await setOpeningBalance(req.body?.amount, {
      userName: req.session?.user?.name || 'Cashier',
      force,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to set opening balance.' });
  }
});

router.post('/reconcile', manageDeposits, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await reconcile(req.body?.actualBalance, {
      userName: req.session?.user?.name || 'Cashier',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to reconcile bank balance.' });
  }
});

router.get('/z-report.pdf', async (req, res) => {
  try {
    const summary = await getDailySummary(req.query.date);
    const pdfBuffer = await generateZReportPdf(summary, req.session?.user?.name || 'Cashier');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="z-report-${summary.date}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate Z-report.' });
  }
});

router.get('/entries/:id/voucher.pdf', async (req, res) => {
  try {
    const entry = await getEntryById(req.params.id);
    let investment = null;
    if (entry.referenceType === 'Investment' && entry.referenceId) {
      investment = await Investment.findById(entry.referenceId);
    }
    if (!investment) {
      investment = await Investment.findOne({ bankLedgerEntryId: entry._id });
    }
    if (!investment) {
      return res.status(404).json({ error: 'Payout voucher not found for this ledger entry.' });
    }

    const pdfBuffer = await generatePayoutVoucherPdf(
      investment,
      entry,
      req.session?.user?.name || investment.cashierProcessedBy || 'Cashier'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payout-${investment.investmentCode || entry._id}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to generate payout voucher.' });
  }
});

module.exports = router;
