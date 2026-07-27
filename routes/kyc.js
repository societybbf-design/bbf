const router = require('express').Router();
const {
  submitKycProfile,
  addKycDocuments,
  getKycDocumentsByMember,
  getPendingKycDocuments,
  reviewKycDocument,
} = require('../services/kycService');
const { saveUploadedFiles } = require('../middleware/upload');
const { requirePermission } = require('../middleware/auth');
const { requireActiveMember } = require('../middleware/memberAccess');
const { publicMemberProfile } = require('../services/memberPrivacy');

const adminOnly = requirePermission('can_manage_kyc');

router.post('/member/profile', requireActiveMember, async (req, res) => {
  try {
    const member = await submitKycProfile(req.session.user.id, req.body);
    return res.json({ member: publicMemberProfile(member) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to submit KYC profile.' });
  }
});

router.post('/member/documents', requireActiveMember, async (req, res) => {
  try {
    const saved = saveUploadedFiles(req.body.files || [], 'kyc');
    const documents = await addKycDocuments(
      req.session.user.id,
      saved.map((file) => ({
        originalname: file.originalName,
        filePath: file.filePath,
      })),
      req.body.documentType || 'other'
    );

    return res.status(201).json({ documents });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to upload KYC documents.' });
  }
});

router.get('/member', requireActiveMember, async (req, res) => {
  try {
    const documents = await getKycDocumentsByMember(req.session.user.id);
    return res.json({ documents });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load KYC documents.' });
  }
});

router.get('/admin/pending', adminOnly, async (req, res) => {
  try {
    const documents = await getPendingKycDocuments();
    return res.json({ documents });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load pending KYC documents.' });
  }
});

router.patch('/admin/:id', adminOnly, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const document = await reviewKycDocument(
      req.params.id,
      status,
      adminNote,
      req.session?.user?.name || 'Admin'
    );
    return res.json({ document });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to review KYC document.' });
  }
});

module.exports = router;
