'use strict';

const LoanIdempotency = require('../models/LoanIdempotency');

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

function resolveLoanIdempotencyKey(req) {
  return req.get?.('Idempotency-Key')
    || req.headers?.['idempotency-key']
    || req.body?.clientRequestId
    || '';
}

/**
 * Claim a loan idempotency key, or return a prior completed response.
 * @returns {Promise<{ kind: 'acquired'|'replay', status?: number, body?: object, key?: string }>}
 */
async function beginLoanIdempotency(rawKey, {
  operation = 'disburse',
  actorId = '',
  loanId = '',
  memberId = '',
  amount = 0,
} = {}) {
  const key = normalizeIdempotencyKey(rawKey);
  if (!key) {
    throw httpError('Idempotency-Key header (or clientRequestId) is required for this loan action.');
  }

  try {
    await LoanIdempotency.create({
      key,
      operation: String(operation || 'disburse'),
      actorId: String(actorId || ''),
      loanId: String(loanId || ''),
      memberId: String(memberId || ''),
      amount: Number(amount) || 0,
      status: 'processing',
    });
    return { kind: 'acquired', key };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const existing = await LoanIdempotency.findOne({ key }).lean();
    if (!existing) {
      throw httpError('Unable to claim loan idempotency key. Retry once.', 409);
    }
    if (existing.status === 'completed' && existing.responseBody) {
      return {
        kind: 'replay',
        key,
        status: existing.responseStatus || 200,
        body: existing.responseBody,
      };
    }
    if (existing.status === 'processing') {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs > 2 * 60 * 1000) {
        const released = await LoanIdempotency.findOneAndDelete({
          _id: existing._id,
          status: 'processing',
        });
        if (released) {
          return beginLoanIdempotency(key, {
            operation,
            actorId,
            loanId,
            memberId,
            amount,
          });
        }
      }
      throw httpError(
        'This loan request is already being processed. Wait a moment before retrying.',
        409
      );
    }

    await LoanIdempotency.deleteOne({ key, status: 'failed' });
    return beginLoanIdempotency(key, {
      operation,
      actorId,
      loanId,
      memberId,
      amount,
    });
  }
}

async function completeLoanIdempotency(key, responseStatus, responseBody) {
  if (!key) return;
  await LoanIdempotency.updateOne(
    { key, status: 'processing' },
    {
      $set: {
        status: 'completed',
        responseStatus: responseStatus || 200,
        responseBody: responseBody || null,
        completedAt: new Date(),
      },
    }
  );
}

async function failLoanIdempotency(key) {
  if (!key) return;
  await LoanIdempotency.updateOne(
    { key, status: 'processing' },
    { $set: { status: 'failed', completedAt: new Date() } }
  );
}

async function withLoanIdempotency(req, meta, work, { successStatus = 200 } = {}) {
  const claim = await beginLoanIdempotency(resolveLoanIdempotencyKey(req), meta);
  if (claim.kind === 'replay') {
    return { replay: true, status: claim.status, body: claim.body };
  }

  try {
    const body = await work();
    await completeLoanIdempotency(claim.key, successStatus, body);
    return { replay: false, status: successStatus, body, key: claim.key };
  } catch (error) {
    await failLoanIdempotency(claim.key);
    throw error;
  }
}

module.exports = {
  normalizeIdempotencyKey,
  resolveLoanIdempotencyKey,
  beginLoanIdempotency,
  completeLoanIdempotency,
  failLoanIdempotency,
  withLoanIdempotency,
};
