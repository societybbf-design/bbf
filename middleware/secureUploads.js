const path = require('path');
const fs = require('fs');
const KycDocument = require('../models/KycDocument');
const LoanApplication = require('../models/LoanApplication');
const LoanRepayment = require('../models/LoanRepayment');
const ChatMessage = require('../models/ChatMessage');
const { requireAuth } = require('./auth');
const { userHasAnyPermission, isFullAccessRole, isAbsoluteControlRole } = require('../services/rbac');

const UPLOADS_ROOT = path.resolve(__dirname, '..', 'uploads');

function normalizeUploadUrlPath(rawPath = '') {
  let value = String(rawPath || '').trim();
  if (!value) return '';
  // Accept "/uploads/..." or "uploads/..." or absolute app-relative paths
  value = value.replace(/^https?:\/\/[^/]+/i, '');
  if (value.startsWith('/uploads/')) return value;
  if (value.startsWith('uploads/')) return `/${value}`;
  if (!value.startsWith('/')) value = `/${value}`;
  if (!value.startsWith('/uploads/')) {
    value = `/uploads${value.startsWith('/') ? '' : '/'}${value.replace(/^\/+/, '')}`;
  }
  return value.replace(/\/+/g, '/');
}

function resolveSafeUploadFile(urlPath) {
  const normalized = normalizeUploadUrlPath(urlPath);
  if (!normalized.startsWith('/uploads/')) {
    const error = new Error('Invalid upload path.');
    error.status = 400;
    throw error;
  }

  const relative = normalized.replace(/^\/uploads\//, '');
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) {
    const error = new Error('Invalid upload path.');
    error.status = 400;
    throw error;
  }

  const fullPath = path.resolve(UPLOADS_ROOT, relative);
  if (!fullPath.startsWith(UPLOADS_ROOT + path.sep) && fullPath !== UPLOADS_ROOT) {
    const error = new Error('Invalid upload path.');
    error.status = 400;
    throw error;
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    const error = new Error('File not found.');
    error.status = 404;
    throw error;
  }

  return { urlPath: normalized, fullPath, relative };
}

function staffCanAccessUploads(user) {
  if (!user) return false;
  if (isFullAccessRole(user.role) || isAbsoluteControlRole(user.role)) return true;
  // View-only investors must not download KYC / loan / chat files.
  return userHasAnyPermission(user, [
    'can_manage_members',
    'can_manage_loans',
    'can_manage_kyc',
    'can_manage_chat',
    'can_manage_deposits',
    'can_manage_withdrawals',
    'can_manage_refunds',
  ]);
}

async function memberOwnsUpload(memberId, urlPath) {
  const id = String(memberId);
  const pathVariants = [urlPath, urlPath.replace(/^\//, '')];

  const [kyc, loan, repayment, chat] = await Promise.all([
    KycDocument.exists({ member: id, filePath: { $in: pathVariants } }),
    LoanApplication.exists({
      member: id,
      $or: [
        { contractPath: { $in: pathVariants } },
        { signedContractPath: { $in: pathVariants } },
        { 'documents.filePath': { $in: pathVariants } },
      ],
    }),
    LoanRepayment.exists({
      member: id,
      $or: [
        { receiptPath: { $in: pathVariants } },
        { 'documents.filePath': { $in: pathVariants } },
      ],
    }),
    ChatMessage.exists({
      member: id,
      'attachments.filePath': { $in: pathVariants },
    }),
  ]);

  return Boolean(kyc || loan || repayment || chat);
}

/**
 * Authenticated download of /uploads/* with ownership checks.
 * Staff with relevant permissions may access any upload.
 * Members may only access files linked to their own records.
 */
async function serveProtectedUpload(req, res) {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const requestPath = `/uploads/${req.params[0] || ''}`;
    const { urlPath, fullPath } = resolveSafeUploadFile(requestPath);

    if (staffCanAccessUploads(user)) {
      return res.sendFile(fullPath);
    }

    if (user.role === 'member') {
      const allowed = await memberOwnsUpload(user.id, urlPath);
      if (!allowed) {
        return res.status(403).json({ error: 'You do not have access to this file.' });
      }
      return res.sendFile(fullPath);
    }

    return res.status(403).json({ error: 'Forbidden' });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to download file.' });
  }
}

function mountProtectedUploads(app) {
  app.use('/uploads', requireAuth, (req, res) => {
    // Mounted at /uploads — rebuild full path for ownership checks
    const relative = String(req.path || '').replace(/^\/+/, '');
    req.params = req.params || {};
    req.params[0] = relative;
    void serveProtectedUpload(req, res);
  });
}

module.exports = {
  mountProtectedUploads,
  serveProtectedUpload,
  normalizeUploadUrlPath,
  resolveSafeUploadFile,
  memberOwnsUpload,
};
