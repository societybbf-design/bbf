const router = require('express').Router();
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const Investment = require('../models/Investment');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { getGroupedSocietyInvestments, getInvestmentSummary, listPendingMemberInvestmentRequests, approveInvestmentByMember } = require('../services/investmentService');
const {
  listPendingExitRequestsForMember,
  approveExitByDepartingMember,
  rejectExitByDepartingMember,
  approveExitByMember,
} = require('../services/memberExitService');
const { getDuesAlert, getNotices, getMemberDepositHistory } = require('../services/memberService');
const { getLatestDistribution, getMemberProfitHistory } = require('../services/profitService');
const { getRefundsByMember, createMemberRefundRequest } = require('../services/refundService');
const { generateInvestmentReceiptPdf } = require('../services/notificationService');
const { requireActiveMember } = require('../middleware/memberAccess');
const {
  publicMemberProfile,
  sanitizeGroupedInvestmentsForMember,
  sanitizeInvestmentForMember,
} = require('../services/memberPrivacy');

router.use(requireActiveMember);

router.get('/profile', async (req, res) => {
  const member = await User.findById(req.session.user.id).select('-password');
  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }
  res.json({ member: publicMemberProfile(member) });
});

router.get('/investments', async (req, res) => {
  try {
    const [grouped, summary] = await Promise.all([
      getGroupedSocietyInvestments(),
      getInvestmentSummary(),
    ]);
    const safe = sanitizeGroupedInvestmentsForMember(grouped);
    res.json({
      investments: safe.all,
      activeInvestments: safe.active,
      soldInvestments: safe.sold,
      summary: {
        totalInvested: Number(summary.totalInvested || 0),
        activeCount: Number(summary.activeCount || safe.active.length || 0),
        soldCount: Number(summary.soldCount || safe.sold.length || 0),
        // Society pool total only — not other members' individual balances
        totalSavings: Number(summary.totalSavings || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load investments.' });
  }
});

router.get('/investment-requests', async (req, res) => {
  try {
    const requests = await listPendingMemberInvestmentRequests(req.session.user.id);
    return res.json({ requests: requests.map(sanitizeInvestmentForMember) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load investment requests.' });
  }
});

router.post('/investment-requests/:id/approve', async (req, res) => {
  try {
    const result = await approveInvestmentByMember(req.params.id, req.session.user.id);
    return res.json({
      ...result,
      investment: result.investment ? sanitizeInvestmentForMember(result.investment) : null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to approve investment.' });
  }
});

router.get('/exit-requests', async (req, res) => {
  try {
    const requests = await listPendingExitRequestsForMember(req.session.user.id);
    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load exit requests.' });
  }
});

router.post('/exit-requests/:id/approve', async (req, res) => {
  try {
    const memberId = req.session.user.id;
    const pending = await listPendingExitRequestsForMember(memberId);
    const target = pending.find((row) => String(row._id) === String(req.params.id));
    if (!target) {
      return res.status(404).json({ error: 'Exit request not found or not awaiting your approval.' });
    }

    let result;
    if (target.status === 'pending_departing_approval') {
      result = await approveExitByDepartingMember(req.params.id, memberId);
    } else {
      result = await approveExitByMember(req.params.id, memberId);
    }
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to approve exit request.' });
  }
});

router.post('/exit-requests/:id/reject', async (req, res) => {
  try {
    const result = await rejectExitByDepartingMember(
      req.params.id,
      req.session.user.id,
      req.body?.reason
    );
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to reject exit request.' });
  }
});

router.get('/investments/:id/receipt', async (req, res) => {
  try {
    const memberId = String(req.session.user.id);
    const investment = await Investment.findById(req.params.id);
    if (!investment) {
      return res.status(404).json({ error: 'Investment receipt not found.' });
    }

    // Society investments (member: null) are visible to active members.
    // Private / member-scoped investments require ownership.
    const ownerId = investment.member ? String(investment.member) : null;
    if (ownerId && ownerId !== memberId) {
      return res.status(403).json({ error: 'You do not have access to this investment receipt.' });
    }

    // Strip bank fields before PDF generation by using a lean public copy where possible
    const pdfBuffer = await generateInvestmentReceiptPdf(investment, investment.createdBy || 'Admin');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="investment-${investment._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate investment receipt.' });
  }
});

router.get('/financial', async (req, res) => {
  try {
    const memberId = req.session.user.id;
    const totalMembers = await User.countDocuments({ role: 'member', status: 'active' });
    const member = await User.findById(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    const grouped = await getGroupedSocietyInvestments();
    const summary = await getInvestmentSummary();
    const safeGrouped = sanitizeGroupedInvestmentsForMember(grouped);
    const deposits = await Deposit.find({ member: memberId }).sort({ createdAt: -1 });
    const withdrawalRequests = await WithdrawalRequest.find({ member: memberId }).sort({ createdAt: -1 });
    const refunds = await getRefundsByMember(memberId);
    const notices = await getNotices();

    const totalMemberInvestments = summary.totalInvested || 0;
    const totalMemberWithdrawals = withdrawalRequests
      .filter((request) => request.status === 'processed')
      .reduce((sum, request) => sum + Number(request.amount || 0), 0);
    const totalDepositAmount = deposits
      .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const latestDistribution = await getLatestDistribution();
    const profitHistory = await getMemberProfitHistory(memberId);
    const latestShare = profitHistory[0];
    const monthlyProfit = latestShare?.amount || 0;
    const duesAlert = await getDuesAlert({ deposits, memberId }, new Date());
    const { getMemberProfileData } = require('../services/memberService');
    const profileSnapshot = await getMemberProfileData(memberId).catch(() => null);
    const currentMonthStatus = profileSnapshot?.currentMonthStatus || null;
    const { publicMonthlyHistory } = require('../services/memberService');
    const monthlyHistory = publicMonthlyHistory(profileSnapshot?.monthlyHistory || []);
    const arrears = duesAlert?.arrears || null;
    const duesDashboard = arrears?.memberDashboard || null;
    const { getMemberReserveShare } = require('../services/emergencyReserveService');
    const { listInternalBorrowings } = require('../services/advanceBorrowingService');
    const [reserveShare, openBorrowings] = await Promise.all([
      getMemberReserveShare(memberId),
      listInternalBorrowings({ memberId, openOnly: true }),
    ]);

    res.json({
      totalMembers,
      totalInvestment: totalMemberInvestments,
      totalWithdrawn: totalMemberWithdrawals,
      totalDepositAmount: Number(Number(totalDepositAmount || 0).toFixed(2)),
      totalSavings: Number(summary.totalSavings || 0),
      monthlyProfit,
      lastDistribution: latestShare?.createdAt || latestDistribution?.createdAt || null,
      distributionType: 'equal',
      memberProfit: Number(member.profit || 0),
      memberSavings: Number(member.savings || 0),
      memberAdvanceBalance: Number(member.advanceBalance || 0),
      emergencyReserveShare: Number(reserveShare.shareAmount || 0),
      emergencyReserveFundBalance: Number(reserveShare.fundBalance || 0),
      openBorrowings,
      profitHistory,
      investments: safeGrouped.all,
      activeInvestments: safeGrouped.active,
      soldInvestments: safeGrouped.sold,
      deposits,
      withdrawalRequests,
      refunds,
      duesAlert,
      currentMonthStatus,
      monthlyHistory,
      arrears,
      duesDashboard,
      notices,
      member: publicMemberProfile(member),
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch financial data.' });
  }
});

router.get('/deposit-history', async (req, res) => {
  try {
    const payload = await getMemberDepositHistory(req.session.user.id, {
      yearMonth: req.query.yearMonth || '',
    });
    return res.json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to load deposit history.',
    });
  }
});

router.get('/borrowings', async (req, res) => {
  try {
    const { listInternalBorrowings } = require('../services/advanceBorrowingService');
    const borrowings = await listInternalBorrowings({
      memberId: req.session.user.id,
      openOnly: false,
    });
    return res.json({ borrowings });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load borrowings.' });
  }
});

router.get('/emergency-reserve-share', async (req, res) => {
  try {
    const { getMemberReserveShare } = require('../services/emergencyReserveService');
    const share = await getMemberReserveShare(req.session.user.id);
    return res.json(share);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load emergency reserve share.' });
  }
});

router.get('/refunds', async (req, res) => {
  try {
    const refunds = await getRefundsByMember(req.session.user.id);
    return res.json({ refunds });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load refund history.' });
  }
});

router.post('/refunds', async (req, res) => {
  try {
    const result = await createMemberRefundRequest({
      memberId: req.session.user.id,
      amount: req.body?.amount,
      reason: req.body?.reason,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to submit refund request.' });
  }
});

module.exports = router;
