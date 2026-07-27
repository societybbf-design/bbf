const router = require('express').Router();
const {
  distributeProfit,
  getProfitHistory,
  getInvestmentProfitHistory,
  lookupInvestmentForProfit,
  previewAutomaticDividend,
  distributeAutomaticDividend,
  recordInvestmentLoss,
  recordInvestmentProfit,
} = require('../services/profitService');
const { createNotice } = require('../services/memberService');
const { getDistributionType } = require('../services/societyConfig');
const { notifyMemberByEmailAndSms } = require('../services/notificationService');
const User = require('../models/User');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');

router.use(requireAuth, requirePermission('can_manage_profit', 'can_view_reports'));
const manageProfit = requirePermission('can_manage_profit');

router.get('/investment-lookup/:code', async (req, res) => {
  try {
    const investment = await lookupInvestmentForProfit(req.params.code);
    return res.json({ investment });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to find investment.' });
  }
});

router.post('/investment', manageProfit, requirePasswordConfirmation, async (req, res) => {
  try {
    const { investmentCode, saleAmount, profitAmount, distributionType, notes } = req.body;
    const result = await recordInvestmentProfit({
      investmentCode,
      saleAmount,
      profitAmount,
      distributionType: getDistributionType(),
      notes,
      recordedBy: req.session?.user?.name || 'Admin',
    });

    const shareSummary = result.updatedMembers
      .map((member) => `${member.memberName}: $${member.share.toFixed(2)}`)
      .join(', ');

    await createNotice({
      title: `Profit Recorded for ${result.investment.investmentCode}`,
      message: `Profit of $${result.calculatedProfit.toFixed(2)} from investment ${result.investment.investmentCode} was distributed. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    let message = `Investment return recorded. Sale proceeds credited to the bank ledger.`;
    if (result.bookBalance != null) {
      message += ` Book balance now $${Number(result.bookBalance).toFixed(2)}.`;
    }

    return res.status(201).json({ ...result, message });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Could not record investment profit.',
    });
  }
});

router.post('/investment-loss', manageProfit, requirePasswordConfirmation, async (req, res) => {
  try {
    const { investmentCode, saleAmount, lossAmount, notes } = req.body;
    const result = await recordInvestmentLoss({
      investmentCode,
      saleAmount,
      lossAmount,
      notes,
      recordedBy: req.session?.user?.name || 'Admin',
    });

    const shareSummary = result.updatedMembers
      .map((member) => `${member.memberName}: -$${member.share.toFixed(2)}`)
      .join(', ');

    await createNotice({
      title: `Loss Recorded for ${result.investment.investmentCode}`,
      message: `Loss of $${result.calculatedLoss.toFixed(2)} from investment ${result.investment.investmentCode} was shared equally. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Could not record investment loss.',
    });
  }
});

router.get('/investment-history', async (req, res) => {
  try {
    const records = await getInvestmentProfitHistory();
    return res.json({ records });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investment profit history.' });
  }
});

router.post('/distribute', manageProfit, requirePasswordConfirmation, async (req, res) => {
  try {
    const { totalAmount, distributionType, notes } = req.body;
    const result = await distributeProfit({
      totalAmount,
      distributionType: getDistributionType(),
      notes,
      distributedBy: req.session?.user?.name || 'Admin',
    });

    const shareSummary = result.updatedMembers
      .map((member) => `${member.memberName}: $${member.share.toFixed(2)}`)
      .join(', ');

    await createNotice({
      title: 'Profit Distributed',
      message: `A profit of $${Number(totalAmount).toFixed(2)} was distributed to all members. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    await Promise.all(result.updatedMembers.map(async (item) => {
      const member = await User.findById(item.memberId).select('email phone name');
      return notifyMemberByEmailAndSms(member, {
        subject: 'Profit Distribution Received',
        message: `Dear ${item.memberName}, you received $${item.share.toFixed(2)} from the latest profit distribution.`,
      });
    }));

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Could not distribute profit.',
    });
  }
});

router.post('/dividend/preview', manageProfit, async (req, res) => {
  try {
    const preview = await previewAutomaticDividend(req.body.totalAmount);
    return res.json(preview);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to preview dividend.' });
  }
});

router.post('/dividend/distribute', manageProfit, requirePasswordConfirmation, async (req, res) => {
  try {
    const { totalAmount, notes } = req.body;
    const result = await distributeAutomaticDividend({
      totalAmount,
      notes,
      distributedBy: req.session?.user?.name || 'Admin',
    });

    const shareSummary = result.updatedMembers
      .map((member) => `${member.memberName}: $${member.share.toFixed(2)}`)
      .join(', ');

    await createNotice({
      title: 'Automatic Dividend Distributed',
      message: `Dividend pool of $${Number(totalAmount).toFixed(2)} was distributed based on savings and profit. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    await Promise.all(result.updatedMembers.map(async (item) => {
      const member = await User.findById(item.memberId).select('email phone name');
      return notifyMemberByEmailAndSms(member, {
        subject: 'Dividend Credited',
        message: `Dear ${item.memberName}, your dividend share of $${item.share.toFixed(2)} has been credited.`,
      });
    }));

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Could not distribute dividend.' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const distributions = await getProfitHistory();
    return res.json({ distributions });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load profit history.' });
  }
});

module.exports = router;
