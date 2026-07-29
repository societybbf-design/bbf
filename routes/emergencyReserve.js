'use strict';

const { formatMoney } = require('../services/moneyFormat');
const router = require('express').Router();
const {
  getFund,
  allocateFromBookBalance,
  allocateToBookBalance,
  coverContributionFromReserve,
  listMemberReserveShares,
} = require('../services/emergencyReserveService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_deposits'));

router.get('/', async (req, res) => {
  try {
    const fund = await getFund({
      entryLimit: Number(req.query.limit) || 40,
      includeShares: req.query.shares !== '0',
    });
    return res.json(fund);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load emergency reserve fund.' });
  }
});

router.get('/member-shares', async (req, res) => {
  try {
    const shares = await listMemberReserveShares();
    return res.json(shares);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load reserve member shares.' });
  }
});

router.post('/allocate', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await allocateFromBookBalance(req.body?.amount, {
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    let message = result.message
      || `Allocated ${formatMoney(Number(req.body?.amount || 0), 2)} to Emergency / Reserve Fund.`;
    if (result.bookBalance != null) {
      message += ` Book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
    }
    message += ` Reserve balance now ${formatMoney(Number(result.fund?.balance || 0), 2)}.`;
    return res.status(201).json({ ...result, message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to allocate to reserve fund.' });
  }
});

router.post('/return-to-book', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await allocateToBookBalance(req.body?.amount, {
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    let message = result.message
      || `Transferred ${formatMoney(Number(req.body?.amount || 0), 2)} from Emergency / Reserve Fund to book balance.`;
    message += ` Reserve balance now ${formatMoney(Number(result.fund?.balance || 0), 2)}.`;
    if (result.bookBalance != null) {
      message += ` Book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
    }
    return res.status(201).json({ ...result, message });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to transfer reserve to book balance.' });
  }
});

router.post('/cover-contribution/:id', requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await coverContributionFromReserve(req.params.id, {
      amount: req.body?.amount,
      note: req.body?.note || '',
      createdBy: req.session?.user?.name || 'Cashier',
    });
    return res.json({
      ...result,
      message: `Covered ${formatMoney(Number(result.coveredAmount || 0), 2)} from Emergency / Reserve Fund.`
        + (result.remainingUnpaid > 0
          ? ` Still due ${formatMoney(Number(result.remainingUnpaid), 2)}.`
          : ' Share fully covered.'),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to cover contribution from reserve.' });
  }
});

module.exports = router;
