const path = require('path');
const fs = require('fs');

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 8 * 1024 * 1024; // 8MB
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.doc', '.docx', '.xls', '.xlsx', '.txt',
]);

function ensureUploadDir(subfolder) {
  const dir = path.join(uploadsRoot, subfolder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveUploadedFiles(files = [], subfolder = 'documents') {
  if (!Array.isArray(files) || !files.length) {
    return [];
  }

  const dir = ensureUploadDir(subfolder);
  const saved = [];

  for (const file of files) {
    if (!file?.data || !file?.name) {
      continue;
    }

    const originalName = String(file.name);
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      const error = new Error(`File type not allowed: ${ext || '(none)'}.`);
      error.status = 400;
      throw error;
    }

    const buffer = Buffer.from(file.data, 'base64');
    if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
      const error = new Error(`File too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`);
      error.status = 400;
      throw error;
    }

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}-${safeName}`;
    fs.writeFileSync(path.join(dir, filename), buffer);

    saved.push({
      originalName: file.name,
      filePath: `/uploads/${subfolder}/${filename}`,
      uploadedAt: new Date(),
    });
  }

  return saved;
}

module.exports = {
  uploadsRoot,
  saveUploadedFiles,
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
};
