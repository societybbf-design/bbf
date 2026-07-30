const { formatMoney } = require('../services/moneyFormat');
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
const {
  beginProfitCloseIdempotency,
  completeProfitCloseIdempotency,
  failProfitCloseIdempotency,
} = require('../services/profitCloseIdempotencyService');
const { clientIp } = require('../services/securityService');

router.use(requireAuth, requirePermission('can_manage_profit', 'can_view_reports'));
const manageProfit = requirePermission('can_manage_profit');

function resolveIdempotencyKey(req) {
  return req.get?.('Idempotency-Key')
    || req.headers?.['idempotency-key']
    || req.body?.clientRequestId
    || '';
}

async function withProfitCloseIdempotency(req, meta, work) {
  const claim = await beginProfitCloseIdempotency(resolveIdempotencyKey(req), meta);
  if (claim.kind === 'replay') {
    return { replay: true, status: claim.status, body: claim.body };
  }
  try {
    const body = await work();
    await completeProfitCloseIdempotency(claim.key, 201, body);
    return { replay: false, status: 201, body };
  } catch (error) {
    await failProfitCloseIdempotency(claim.key);
    throw error;
  }
}

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
    const {
      investmentCode,
      saleAmount,
      profitAmount,
      principalToClose,
      notes,
    } = req.body;

    const outcome = await withProfitCloseIdempotency(req, {
      actorId: req.session?.user?.id || req.session?.user?._id || '',
      investmentCode: String(investmentCode || ''),
      amount: Number(saleAmount) || 0,
    }, async () => {
      const result = await recordInvestmentProfit({
        investmentCode,
        saleAmount,
        profitAmount,
        principalToClose,
        distributionType: getDistributionType(),
        notes,
        recordedBy: req.session?.user?.name || 'Admin',
        recordedByUserId: req.session?.user?.id || req.session?.user?._id || null,
        clientRequestId: resolveIdempotencyKey(req),
        actor: req.session?.user || null,
        ip: clientIp(req),
      });

      const shareSummary = (result.updatedMembers || [])
        .map((member) => `${member.memberName}: ${formatMoney(member.share, 2)}`)
        .join(', ');

      const outcomeLabel = result.outcomeType || 'profit';
      const amountLabel = outcomeLabel === 'loss'
        ? formatMoney(result.calculatedLoss || 0, 2)
        : formatMoney(result.calculatedProfit || 0, 2);

      await createNotice({
        title: `${result.isPartial ? 'Partial ' : ''}Investment ${outcomeLabel} — ${result.investment.investmentCode}`,
        message: outcomeLabel === 'loss'
          ? `Loss of ${amountLabel} from ${result.investment.investmentCode} was shared equally. ${shareSummary}`
          : `Profit of ${amountLabel} from ${result.investment.investmentCode} was distributed. ${shareSummary}`,
        author: req.session?.user?.name || 'Admin',
      });

      let message = result.isPartial
        ? `Partial close recorded (${outcomeLabel}). Remaining principal ${formatMoney(result.remainingPrincipal || 0, 2)}.`
        : `Investment return recorded (${outcomeLabel}).`;
      if (result.bookBalance != null) {
        message += ` Book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
      }

      return {
        ...result,
        message,
        idempotentReplay: false,
      };
    });

    if (outcome.replay) {
      return res.status(outcome.status).json({ ...outcome.body, idempotentReplay: true });
    }
    return res.status(201).json(outcome.body);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Could not record investment profit.',
    });
  }
});

router.post('/investment-loss', manageProfit, requirePasswordConfirmation, async (req, res) => {
  try {
    const { investmentCode, saleAmount, lossAmount, principalToClose, notes } = req.body;

    const outcome = await withProfitCloseIdempotency(req, {
      actorId: req.session?.user?.id || req.session?.user?._id || '',
      investmentCode: String(investmentCode || ''),
      amount: Number(saleAmount) || 0,
    }, async () => {
      const result = await recordInvestmentLoss({
        investmentCode,
        saleAmount,
        lossAmount,
        principalToClose,
        notes,
        recordedBy: req.session?.user?.name || 'Admin',
        recordedByUserId: req.session?.user?.id || req.session?.user?._id || null,
        clientRequestId: resolveIdempotencyKey(req),
        actor: req.session?.user || null,
        ip: clientIp(req),
      });

      const shareSummary = (result.updatedMembers || [])
        .map((member) => `${member.memberName}: -${formatMoney(member.share, 2)}`)
        .join(', ');

      await createNotice({
        title: `Loss Recorded for ${result.investment.investmentCode}`,
        message: `Loss of ${formatMoney(result.calculatedLoss, 2)} from investment ${result.investment.investmentCode} was shared equally. ${shareSummary}`,
        author: req.session?.user?.name || 'Admin',
      });

      let message = result.isPartial
        ? `Partial loss close recorded. Remaining principal ${formatMoney(result.remainingPrincipal || 0, 2)}.`
        : 'Investment loss recorded and shared.';
      if (result.bookBalance != null) {
        message += ` Book balance now ${formatMoney(Number(result.bookBalance), 2)}.`;
      }

      return {
        ...result,
        message,
        idempotentReplay: false,
      };
    });

    if (outcome.replay) {
      return res.status(outcome.status).json({ ...outcome.body, idempotentReplay: true });
    }
    return res.status(201).json(outcome.body);
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
      .map((member) => `${member.memberName}: ${formatMoney(member.share, 2)}`)
      .join(', ');

    await createNotice({
      title: 'Profit Distributed',
      message: `A profit of ${formatMoney(Number(totalAmount), 2)} was distributed to all members. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    await Promise.all(result.updatedMembers.map(async (item) => {
      const member = await User.findById(item.memberId).select('email phone name');
      return notifyMemberByEmailAndSms(member, {
        subject: 'Profit Distribution Received',
        message: `Dear ${item.memberName}, you received ${formatMoney(item.share, 2)} from the latest profit distribution.`,
      });
    }));

    const { notifyProfitDistribution } = require('../services/financialNotificationService');
    const { recordAdminActivity } = require('../services/activityLogService');
    await notifyProfitDistribution({
      members: result.updatedMembers,
      totalAmount,
      distributedBy: req.session?.user?.name || 'Admin',
      distributionId: result.distribution?._id,
    });
    await recordAdminActivity({
      action: 'profit_distributed',
      actor: req.session?.user || null,
      details: {
        totalAmount,
        memberCount: result.updatedMembers?.length || 0,
        distributionId: result.distribution?._id,
      },
      ip: clientIp(req),
    });

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
      .map((member) => `${member.memberName}: ${formatMoney(member.share, 2)}`)
      .join(', ');

    await createNotice({
      title: 'Automatic Dividend Distributed',
      message: `Dividend pool of ${formatMoney(Number(totalAmount), 2)} was distributed based on savings and profit. ${shareSummary}`,
      author: req.session?.user?.name || 'Admin',
    });

    await Promise.all(result.updatedMembers.map(async (item) => {
      const member = await User.findById(item.memberId).select('email phone name');
      return notifyMemberByEmailAndSms(member, {
        subject: 'Dividend Credited',
        message: `Dear ${item.memberName}, your dividend share of ${formatMoney(item.share, 2)} has been credited.`,
      });
    }));

    const { notifyProfitDistribution } = require('../services/financialNotificationService');
    const { recordAdminActivity } = require('../services/activityLogService');
    await notifyProfitDistribution({
      members: result.updatedMembers,
      totalAmount,
      distributedBy: req.session?.user?.name || 'Admin',
      distributionId: result.distribution?._id,
    });
    await recordAdminActivity({
      action: 'profit_distributed',
      actor: req.session?.user || null,
      details: {
        totalAmount,
        type: 'automatic_dividend',
        memberCount: result.updatedMembers?.length || 0,
        distributionId: result.distribution?._id,
      },
      ip: clientIp(req),
    });

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
