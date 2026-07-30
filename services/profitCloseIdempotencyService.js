'use strict';

const ProfitCloseIdempotency = require('../models/ProfitCloseIdempotency');

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeIdempotencyKey(raw) {
  const key = String(raw || '').trim();
  if (!key) return '';
  if (key.length < 8 || key.length > 128) {
    throw httpError('Idempotency key must be between 8 and 128 characters.');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw httpError('Idempotency key contains invalid characters.');
  }
  return key;
}

async function beginProfitCloseIdempotency(rawKey, {
  actorId = '',
  investmentCode = '',
  amount = 0,
} = {}) {
  const key = normalizeIdempotencyKey(rawKey);
  if (!key) {
    throw httpError('Idempotency-Key header (or clientRequestId) is required for investment closing.');
  }

  try {
    await ProfitCloseIdempotency.create({
      key,
      actorId: String(actorId || ''),
      investmentCode: String(investmentCode || ''),
      amount: Number(amount) || 0,
      status: 'processing',
    });
    return { kind: 'acquired', key };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const existing = await ProfitCloseIdempotency.findOne({ key }).lean();
    if (!existing) {
      throw httpError('Unable to claim investment-close idempotency key. Retry once.', 409);
    }
    if (existing.status === 'completed' && existing.responseBody) {
      return {
        kind: 'replay',
        key,
        status: existing.responseStatus || 201,
        body: existing.responseBody,
      };
    }
    if (existing.status === 'processing') {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs > 2 * 60 * 1000) {
        const released = await ProfitCloseIdempotency.findOneAndDelete({
          _id: existing._id,
          status: 'processing',
        });
        if (released) {
          return beginProfitCloseIdempotency(key, { actorId, investmentCode, amount });
        }
      }
      throw httpError(
        'This investment close request is already being processed. Wait a moment before retrying.',
        409
      );
    }

    await ProfitCloseIdempotency.deleteOne({ key, status: 'failed' });
    return beginProfitCloseIdempotency(key, { actorId, investmentCode, amount });
  }
}

async function completeProfitCloseIdempotency(key, responseStatus, responseBody) {
  if (!key) return;
  await ProfitCloseIdempotency.updateOne(
    { key, status: 'processing' },
    {
      $set: {
        status: 'completed',
        responseStatus: responseStatus || 201,
        responseBody: responseBody || null,
        completedAt: new Date(),
      },
    }
  );
}

async function failProfitCloseIdempotency(key) {
  if (!key) return;
  await ProfitCloseIdempotency.updateOne(
    { key, status: 'processing' },
    { $set: { status: 'failed', completedAt: new Date() } }
  );
}

module.exports = {
  normalizeIdempotencyKey,
  beginProfitCloseIdempotency,
  completeProfitCloseIdempotency,
  failProfitCloseIdempotency,
};
