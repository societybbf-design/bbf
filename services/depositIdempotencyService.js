'use strict';

const DepositIdempotency = require('../models/DepositIdempotency');

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

/**
 * Claim a deposit idempotency key, or return a prior completed response.
 * @returns {Promise<{ kind: 'acquired'|'replay', status?: number, body?: object }>}
 */
async function beginDepositIdempotency(rawKey, { actorId = '', memberId = '', amount = 0 } = {}) {
  const key = normalizeIdempotencyKey(rawKey);
  if (!key) {
    throw httpError('Idempotency-Key header (or clientRequestId) is required for deposit recording.');
  }

  try {
    await DepositIdempotency.create({
      key,
      actorId: String(actorId || ''),
      memberId: String(memberId || ''),
      amount: Number(amount) || 0,
      status: 'processing',
    });
    return { kind: 'acquired', key };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const existing = await DepositIdempotency.findOne({ key }).lean();
    if (!existing) {
      throw httpError('Unable to claim deposit idempotency key. Retry once.', 409);
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
      // Stale processing locks (crash mid-request) can be reclaimed after 2 minutes.
      if (ageMs > 2 * 60 * 1000) {
        const released = await DepositIdempotency.findOneAndDelete({
          _id: existing._id,
          status: 'processing',
        });
        if (released) {
          return beginDepositIdempotency(key, { actorId, memberId, amount });
        }
      }
      throw httpError(
        'This deposit request is already being processed. Wait a moment before retrying.',
        409
      );
    }

    // Previous attempt failed — allow a clean retry with the same key.
    await DepositIdempotency.deleteOne({ key, status: 'failed' });
    return beginDepositIdempotency(key, { actorId, memberId, amount });
  }
}

async function completeDepositIdempotency(key, responseStatus, responseBody) {
  if (!key) return;
  await DepositIdempotency.updateOne(
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

async function failDepositIdempotency(key) {
  if (!key) return;
  await DepositIdempotency.updateOne(
    { key, status: 'processing' },
    { $set: { status: 'failed', completedAt: new Date() } }
  );
}

module.exports = {
  normalizeIdempotencyKey,
  beginDepositIdempotency,
  completeDepositIdempotency,
  failDepositIdempotency,
};
