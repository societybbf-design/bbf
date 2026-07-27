#!/usr/bin/env node
/**
 * Validates production environment before deploy / start.
 * Usage: NODE_ENV=production node scripts/check-production.js
 */
require('dotenv').config();

const weakSecrets = new Set([
  '',
  'society-secret',
  'change-this-to-a-random-secret',
  'secret',
  'password',
]);

const problems = [];
const warnings = [];

const mongoUri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
if (!mongoUri) {
  problems.push('Missing MONGO_URI (or MONGODB_URI)');
} else if (!mongoUri.includes('mongodb')) {
  problems.push('MONGO_URI / MONGODB_URI does not look like a MongoDB connection string');
}

if (weakSecrets.has(String(process.env.SESSION_SECRET || '').trim())) {
  problems.push('SESSION_SECRET is missing or still using a default/weak value');
}

if (process.env.NODE_ENV !== 'production') {
  warnings.push('NODE_ENV is not "production" (Hostinger should set NODE_ENV=production)');
}

if (!process.env.APP_URL) {
  warnings.push('APP_URL is not set (recommended: https://your-domain.com)');
}

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  warnings.push('SMTP credentials missing — deposit receipts and OTP email will not send');
}

if (problems.length) {
  console.error('Production check FAILED:');
  problems.forEach((p) => console.error('  ✗', p));
  process.exit(1);
}

console.log('Production check passed.');
warnings.forEach((w) => console.warn('  !', w));
process.exit(0);
