const router = require('express').Router();
const path = require('path');
const {
  createLoanApplication,
  getLoanEligibility,
  getLoanApplicationsForMember,
  getLoanApplicationsForAdmin,
  getLoanApplicationById,
  getLoansByMemberId,
  getMemberLoanDashboardSummary,
  getLoanContractFile,
  uploadSignedLoanContract,
  updateLoanApplicationStatus,
  disburseLoanApplication,
  getAllLoanTakers,
  getActiveBorrowers,
  getLoanPortfolioSummary,
} = require('../services/loanService');
const {
  getMemberOutstandingSummary,
  recordAdminLoanRepayment,
  getRepaymentsForMember,
  getRepaymentsForAdmin,
  getRepaymentReceiptFile,
  updateLoanRepaymentStatus,
} = require('../services/loanRepaymentService');
const { saveUploadedFiles } = require('../middleware/upload');
const LoanApplication = require('../models/LoanApplication');
const { requirePermission, requirePasswordConfirmation } = require('../middleware/auth');
const { requireActiveMember } = require('../middleware/memberAccess');

const adminOnly = requirePermission('can_manage_loans');

router.get('/member/eligibility', requireActiveMember, async (req, res) => {
  try {
    const eligibility = await getLoanEligibility(req.session.user.id);
    return res.json(eligibility);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load loan eligibility.' });
  }
});

router.get('/member/summary', requireActiveMember, async (req, res) => {
  try {
    const summary = await getMemberLoanDashboardSummary(req.session.user.id);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan summary.' });
  }
});

router.post('/member', requireActiveMember, async (req, res) => {
  try {
    const documents = saveUploadedFiles(req.body.files || [], 'loans');

    const result = await createLoanApplication({
      memberId: req.session.user.id,
      amount: req.body.amount,
      loanType: req.body.loanType,
      reason: req.body.reason,
      witnessName: req.body.witnessName,
      witnessPhone: req.body.witnessPhone,
      witnessRelation: req.body.witnessRelation,
      documents,
    });

    if (result.autoRejected) {
      return res.status(400).json({
        error: result.loan.rejectionReason || 'Loan amount exceeds 80% of your total savings.',
        loan: result.loan,
        autoRejected: true,
      });
    }

    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to submit loan application.' });
  }
});

router.get('/member/repayments/outstanding', requireActiveMember, async (req, res) => {
  try {
    const summary = await getMemberOutstandingSummary(req.session.user.id);
    return res.json(summary);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load outstanding loan.' });
  }
});

router.get('/member/repayments', requireActiveMember, async (req, res) => {
  try {
    const repayments = await getRepaymentsForMember(req.session.user.id);
    return res.json({ repayments });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan repayments.' });
  }
});

router.post('/member/repayments', requireActiveMember, async (req, res) => {
  return res.status(403).json({
    error: 'Loan payments are processed manually by admin. Please visit the society office to pay your loan.',
  });
});

router.get('/member/repayments/:id/receipt', requireActiveMember, async (req, res) => {
  try {
    const LoanRepayment = require('../models/LoanRepayment');
    const repayment = await LoanRepayment.findOne({ _id: req.params.id, member: req.session.user.id }).lean();
    if (!repayment || repayment.status !== 'approved') {
      return res.status(404).json({ error: 'Receipt not found.' });
    }
    const { fullPath } = await getRepaymentReceiptFile(repayment._id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="loan-repayment-${repayment._id}.pdf"`);
    return res.sendFile(path.resolve(fullPath));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to download receipt.' });
  }
});

router.get('/member', requireActiveMember, async (req, res) => {
  try {
    const loans = await getLoanApplicationsForMember(req.session.user.id);
    return res.json({ loans });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan applications.' });
  }
});

router.get('/member/:id/contract', requireActiveMember, async (req, res) => {
  try {
    const loan = await LoanApplication.findOne({ _id: req.params.id, member: req.session.user.id }).lean();
    if (!loan) {
      return res.status(404).json({ error: 'Loan application not found.' });
    }

    const { fullPath } = await getLoanContractFile(loan._id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="loan-contract-${loan._id}.pdf"`);
    return res.sendFile(path.resolve(fullPath));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to download contract.' });
  }
});

router.post('/member/:id/signed-contract', requireActiveMember, async (req, res) => {
  try {
    const saved = saveUploadedFiles(req.body.files || [], 'signed-contracts');
    if (!saved.length) {
      return res.status(400).json({ error: 'Signed contract file is required.' });
    }

    const loan = await uploadSignedLoanContract(req.params.id, req.session.user.id, saved[0].filePath);
    return res.json({ loan });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to upload signed contract.' });
  }
});

router.get('/admin/repayments', adminOnly, async (req, res) => {
  try {
    const repayments = await getRepaymentsForAdmin({ status: req.query.status });
    return res.json({ repayments });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan repayments.' });
  }
});

router.patch('/admin/repayments/:id', adminOnly, requirePasswordConfirmation, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const repayment = await updateLoanRepaymentStatus(
      req.params.id,
      status,
      adminNote,
      req.session?.user?.name || 'Admin'
    );
    return res.json({ repayment });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update loan repayment.' });
  }
});

router.get('/admin/repayments/:id/receipt', adminOnly, async (req, res) => {
  try {
    const { fullPath } = await getRepaymentReceiptFile(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="loan-repayment-${req.params.id}.pdf"`);
    return res.sendFile(path.resolve(fullPath));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to download receipt.' });
  }
});

router.get('/admin/summary', adminOnly, async (req, res) => {
  try {
    const summary = await getLoanPortfolioSummary();
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan summary.' });
  }
});

router.get('/admin/takers', adminOnly, async (req, res) => {
  try {
    const takers = await getAllLoanTakers();
    return res.json({ takers });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan takers.' });
  }
});

router.get('/admin/active-borrowers', adminOnly, async (req, res) => {
  try {
    const borrowers = await getActiveBorrowers({
      monthlyStatus: req.query.monthlyStatus,
    });
    return res.json({ borrowers });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load active borrowers.' });
  }
});

router.get('/admin', adminOnly, async (req, res) => {
  try {
    const loans = await getLoanApplicationsForAdmin({
      status: req.query.status,
      loanType: req.query.loanType,
    });
    return res.json({ loans });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan applications.' });
  }
});

router.get('/admin/member/:memberId', adminOnly, async (req, res) => {
  try {
    const loans = await getLoansByMemberId(req.params.memberId);
    return res.json({ loans });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load member loans.' });
  }
});

router.get('/admin/member/:memberId/outstanding', adminOnly, async (req, res) => {
  try {
    const summary = await getMemberOutstandingSummary(req.params.memberId);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan outstanding summary.' });
  }
});

router.get('/admin/member/:memberId/repayments', adminOnly, async (req, res) => {
  try {
    const repayments = await getRepaymentsForMember(req.params.memberId);
    return res.json({ repayments });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load member loan repayments.' });
  }
});

router.post('/admin/member/:memberId/repayments', adminOnly, requirePasswordConfirmation, async (req, res) => {
  try {
    const result = await recordAdminLoanRepayment({
      memberId: req.params.memberId,
      amount: req.body.amount,
      repaymentType: req.body.repaymentType,
      paymentMethod: req.body.paymentMethod,
      adminNote: req.body.adminNote,
      reviewedBy: req.session?.user?.name || 'Admin',
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to record loan payment.' });
  }
});

router.get('/admin/:id/contract', adminOnly, async (req, res) => {
  try {
    const { fullPath } = await getLoanContractFile(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="loan-contract-${req.params.id}.pdf"`);
    return res.sendFile(path.resolve(fullPath));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to download contract.' });
  }
});

router.get('/admin/:id', adminOnly, async (req, res) => {
  try {
    const loan = await getLoanApplicationById(req.params.id);
    if (!loan) {
      return res.status(404).json({ error: 'Loan application not found.' });
    }
    return res.json({ loan });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load loan application.' });
  }
});

router.patch('/admin/:id', adminOnly, requirePasswordConfirmation, async (req, res) => {
  try {
    const { status, adminNote, paymentMethod } = req.body;
    const loan = await updateLoanApplicationStatus(
      req.params.id,
      status,
      adminNote,
      req.session?.user?.name || 'Admin',
      paymentMethod
    );
    return res.json({ loan });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to update loan application.' });
  }
});

router.post('/admin/:id/disburse', adminOnly, requirePasswordConfirmation, async (req, res) => {
  try {
    const loan = await disburseLoanApplication(req.params.id, {
      paymentMethod: req.body.paymentMethod,
      transferReference: req.body.transferReference,
      disbursementNote: req.body.disbursementNote,
      disbursedBy: req.session?.user?.name || 'Admin',
    });
    return res.json({ loan });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to disburse loan.' });
  }
});

module.exports = router;
