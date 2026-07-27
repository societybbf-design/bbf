const KycDocument = require('../models/KycDocument');
const User = require('../models/User');
const { createAdminNotification } = require('./adminNotificationService');
const { sendTransactionalEmail } = require('./notificationService');
const { sendSms } = require('./smsService');

async function submitKycProfile(memberId, profile = {}) {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (profile.phone) member.phone = profile.phone.trim();
  if (profile.address) member.address = profile.address.trim();
  if (profile.nidNumber) member.nidNumber = profile.nidNumber.trim();
  member.kycStatus = 'submitted';
  await member.save();

  await createAdminNotification({
    type: 'kyc',
    title: `KYC Submitted by ${member.name}`,
    message: `${member.name} submitted KYC details for review.`,
    relatedId: member._id,
    relatedModel: 'User',
  });

  return member;
}

async function addKycDocuments(memberId, files = [], documentType = 'other') {
  const member = await User.findOne({ _id: memberId, role: 'member' });
  if (!member) {
    const error = new Error('Member not found.');
    error.status = 404;
    throw error;
  }

  if (!files.length) {
    const error = new Error('At least one document is required.');
    error.status = 400;
    throw error;
  }

  const documents = await Promise.all(files.map((file) => KycDocument.create({
    member: memberId,
    documentType,
    originalName: file.originalname || file.originalName || 'document',
    filePath: file.filePath || `/uploads/kyc/${file.filename}`,
    status: 'pending',
  })));

  member.kycStatus = member.kycStatus === 'verified' ? 'verified' : 'submitted';
  await member.save();

  await createAdminNotification({
    type: 'kyc',
    title: `KYC Documents Uploaded by ${member.name}`,
    message: `${member.name} uploaded ${documents.length} KYC document(s).`,
    relatedId: member._id,
    relatedModel: 'User',
  });

  return documents;
}

async function getKycDocumentsByMember(memberId) {
  return KycDocument.find({ member: memberId }).sort({ createdAt: -1 }).lean();
}

async function getPendingKycDocuments() {
  return KycDocument.find({ status: 'pending' })
    .populate({ path: 'member', select: 'name email phone kycStatus' })
    .sort({ createdAt: -1 })
    .lean();
}

async function reviewKycDocument(documentId, status, adminNote = '', verifiedBy = 'Admin') {
  const allowedStatuses = ['pending', 'verified', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid KYC status.');
    error.status = 400;
    throw error;
  }

  const document = await KycDocument.findById(documentId).populate({ path: 'member', select: 'name email phone' });
  if (!document) {
    const error = new Error('KYC document not found.');
    error.status = 404;
    throw error;
  }

  document.status = status;
  document.adminNote = adminNote?.trim() || '';
  document.verifiedBy = verifiedBy?.trim() || 'Admin';
  await document.save();

  const member = await User.findById(document.member._id);
  if (member) {
    const memberDocs = await KycDocument.find({ member: member._id });
    const hasRejected = memberDocs.some((item) => item.status === 'rejected');
    const allVerified = memberDocs.length > 0 && memberDocs.every((item) => item.status === 'verified');

    if (hasRejected) {
      member.kycStatus = 'rejected';
    } else if (allVerified) {
      member.kycStatus = 'verified';
    } else {
      member.kycStatus = 'submitted';
    }
    await member.save();

    if (member.email) {
      await sendTransactionalEmail({
        to: member.email,
        subject: 'KYC Document Review Update',
        text: `Dear ${member.name}, your ${document.documentType} document was marked as ${status}.`,
        html: `<p>Dear ${member.name},</p><p>Your <strong>${document.documentType}</strong> document was marked as <strong>${status}</strong>.</p>`,
      });
    }

    if (member.phone) {
      await sendSms({
        to: member.phone,
        message: `KYC update: your ${document.documentType} document is now ${status}.`,
      });
    }
  }

  return document;
}

module.exports = {
  submitKycProfile,
  addKycDocuments,
  getKycDocumentsByMember,
  getPendingKycDocuments,
  reviewKycDocument,
};
