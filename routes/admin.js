const router = require('express').Router();
const Deposit = require('../models/Deposit');
const Investment = require('../models/Investment');
const User = require('../models/User');
const { getSummary, createNotice, getMemberProfileData } = require('../services/memberService');
const {
  listActiveMembers,
  listDeletedMembers,
  getDeletedMemberCount,
  getMemberDeletionSummary,
} = require('../services/memberLifecycleService');
const { createRefund, getRefundsByMember, updateRefundStatus } = require('../services/refundService');
const { getMonthlyContributionReport, generateMonthlyContributionReportPdf } = require('../services/monthlyContributionService');
const { requireAuth, requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const {
  getEntryValuation,
  setMemberOpeningBalances,
  replaceMember,
  getMigrationOverview,
} = require('../services/memberMigrationService');
const { userHasPermission, isFullAccessRole } = require('../services/rbac');

router.use(requireAuth, requirePermission('can_manage_members', 'can_view_reports', 'can_manage_notices', 'can_manage_refunds'));

const manageMembers = requirePermission('can_manage_members');
const manageNotices = requirePermission('can_manage_notices');
const manageRefunds = requirePermission('can_manage_refunds');
const manageMigration = requirePermission('can_manage_members');

function stripSensitiveMemberFields(member) {
  if (!member) return member;
  const plain = typeof member.toObject === 'function' ? member.toObject() : { ...member };
  delete plain.password;
  delete plain.passwordResetOtpHash;
  delete plain.nidNumber;
  delete plain.bankAccountName;
  delete plain.bankAccountNumber;
  delete plain.bankName;
  delete plain.passwordResetOtpExpires;
  return plain;
}

function canSeeMemberPii(user) {
  if (!user) return false;
  return userHasPermission(user, 'can_manage_members')
    || userHasPermission(user, 'can_manage_kyc')
    || isFullAccessRole(user.role);
}

router.get('/members', async (req, res) => {
  const members = await listActiveMembers();
  res.json({
    members: canSeeMemberPii(req.session?.user) ? members : members.map(stripSensitiveMemberFields),
  });
});

router.get('/members/migration-overview', manageMigration, async (req, res) => {
  try {
    const overview = await getMigrationOverview();
    return res.json(overview);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load migration overview.' });
  }
});

router.get('/members/entry-valuation', manageMigration, async (req, res) => {
  try {
    const valuation = await getEntryValuation({
      replaceMemberId: req.query.replaceMemberId || null,
    });
    return res.json({ valuation });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to calculate entry valuation.' });
  }
});

router.post('/members/replace', manageMigration, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await replaceMember({
      departingMemberId: req.body?.departingMemberId,
      newMemberId: req.body?.newMemberId,
      entryAmountPaid: req.body?.entryAmountPaid,
      notes: req.body?.notes,
      recordedBy: req.session?.user?.name || 'CEO',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to replace member.' });
  }
});

router.patch('/members/:id/opening-balance', manageMigration, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await setMemberOpeningBalances({
      memberId: req.params.id,
      openingSavings: req.body?.openingSavings,
      openingProfit: req.body?.openingProfit,
      notes: req.body?.notes,
      recordedBy: req.session?.user?.name || 'CEO',
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to set opening balance.' });
  }
});

router.get('/members/deleted/list', async (req, res) => {
  try {
    const members = await listDeletedMembers();
    return res.json({ members });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load deleted members.' });
  }
});

router.get('/members/deleted/count', async (req, res) => {
  try {
    const count = await getDeletedMemberCount();
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load deleted member count.' });
  }
});

router.get('/members/:id/profile', async (req, res) => {
  try {
    const data = await getMemberProfileData(req.params.id);
    if (!canSeeMemberPii(req.session.user) && data?.member) {
      data.member = stripSensitiveMemberFields(data.member);
    }
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to load member profile.' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const summary = await getSummary();
    const totalDeposits = await Deposit.countDocuments();
    const totalInvestments = await Investment.countDocuments();
    res.json({
      ...summary,
      totalDeposits,
      totalInvestments,
      monthlyContributionAmount: summary.monthlyContributionAmount,
      activeMonthTarget: summary.activeMonthTarget,
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch summary.' });
  }
});

router.post('/notices', manageNotices, async (req, res) => {
  try {
    const payload = await createNotice({
      title: req.body.title?.trim() || 'Notice',
      message: req.body.message?.trim() || '',
      author: req.body.author?.trim() || 'Admin',
    });
    return res.status(201).json({ notice: payload });
  } catch (error) {
    return res.status(500).json({ error: 'Could not create notice.' });
  }
});

router.post('/members', async (req, res) => {
  return res.status(403).json({
    error: 'Member creation is restricted to User Management. Open User Management → Create Account.',
  });
});

// Profile metadata only — balances must go through deposit / opening-balance / refund flows.
router.put('/members/:id', manageMembers, requirePasswordConfirmation, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, profilePicture, dateOfBirth, gender } = req.body;
    if (typeof req.body?.savings !== 'undefined' || typeof req.body?.profit !== 'undefined') {
      return res.status(403).json({
        error: 'Savings and profit cannot be edited directly. Use deposits, opening balance, or refund tools.',
      });
    }
    if (typeof req.body?.status !== 'undefined') {
      return res.status(403).json({
        error: 'Activate/deactivate is restricted to User Management.',
      });
    }

    const updates = {
      ...(name ? { name: name.trim() } : {}),
      ...(typeof profilePicture !== 'undefined' ? { profilePicture: profilePicture?.trim() || '' } : {}),
      ...(typeof dateOfBirth !== 'undefined' ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
      ...(typeof gender !== 'undefined' ? { gender: gender?.trim() || '' } : {}),
    };

    const member = await User.findOneAndUpdate(
      { _id: id, role: 'member' },
      updates,
      { new: true, runValidators: true }
    ).select('-password -passwordResetOtpHash -nidNumber -bankAccountName -bankAccountNumber -bankName');

    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    return res.json({ member });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update member.' });
  }
});

router.patch('/members/:id/status', async (req, res) => {
  return res.status(403).json({
    error: 'Activate/deactivate is restricted to User Management. Open User Management → All Accounts.',
  });
});

router.get('/members/:id/refunds', manageRefunds, async (req, res) => {
  try {
    const refunds = await getRefundsByMember(req.params.id);
    return res.json({ refunds });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load refund history.' });
  }
});

router.post('/members/:id/refunds', manageRefunds, requirePasswordConfirmation, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const refund = await createRefund({
      memberId: req.params.id,
      amount,
      reason,
      recordedBy: req.session?.user?.name || 'Admin',
    });
    return res.status(201).json({ refund });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Could not record refund.' });
  }
});

router.patch('/refunds/:id', manageRefunds, requirePasswordConfirmation, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const refund = await updateRefundStatus(req.params.id, status, adminNote);
    return res.json({ refund });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Could not update refund.' });
  }
});

router.patch('/members/:id/remove', async (req, res) => {
  return res.status(403).json({
    error: 'Account soft-delete is restricted to User Management. Open User Management → All Accounts → Soft-delete.',
  });
});

router.patch('/members/:id/restore', async (req, res) => {
  return res.status(403).json({
    error: 'Account restore is restricted to User Management. Open User Management → filter Deleted → Restore.',
  });
});

router.get('/members/:id/deletion-summary', async (req, res) => {
  try {
    const summary = await getMemberDeletionSummary(req.params.id);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load deletion summary.' });
  }
});

router.delete('/members/:id/permanent', async (req, res) => {
  return res.status(403).json({
    error: 'Hard delete is disabled. Soft-deleted accounts stay in the database and can be restored from User Management.',
  });
});

router.delete('/members/:id', async (req, res) => {
  return res.status(403).json({
    error: 'Account soft-delete is restricted to User Management. Open User Management → All Accounts → Soft-delete.',
  });
});

router.get('/monthly-contributions', async (req, res) => {
  try {
    const report = await getMonthlyContributionReport();
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load monthly contribution report.' });
  }
});

router.get('/monthly-contributions/report.pdf', async (req, res) => {
  try {
    const type = req.query.type === 'unpaid' ? 'unpaid' : 'paid';
    const report = await getMonthlyContributionReport();
    const pdfBuffer = await generateMonthlyContributionReportPdf(report, type);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="monthly-${type}-${Date.now()}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate monthly contribution PDF.' });
  }
});

module.exports = router;
