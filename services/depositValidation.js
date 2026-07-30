'use strict';

const { normalizePaymentChannel } = require('./paymentChannelService');

const MAX_MANUAL_DEPOSIT_AMOUNT = 50_000_000; // hard ceiling against typos / abuse

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Shared cashier deposit input validation (manual + smart payment).
 */
function validateManualDepositInput({
  memberId,
  amount,
  paymentMethod,
  paymentReference,
} = {}) {
  const memberKey = String(memberId || '').trim();
  if (!memberKey) {
    throw httpError('Member and amount are required.');
  }
  if (!/^[a-fA-F0-9]{24}$/.test(memberKey)) {
    throw httpError('A valid member is required.');
  }

  if (typeof amount === 'undefined' || amount === null || amount === '') {
    throw httpError('Member and amount are required.');
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || Number.isNaN(numericAmount)) {
    throw httpError('Deposit amount must be a positive number.');
  }
  if (numericAmount <= 0) {
    throw httpError('Deposit amount must be a positive number.');
  }
  if (numericAmount > MAX_MANUAL_DEPOSIT_AMOUNT) {
    throw httpError(`Deposit amount exceeds the maximum allowed (${MAX_MANUAL_DEPOSIT_AMOUNT}).`);
  }
  // Reject more than 2 decimal places for money.
  const cents = numericAmount * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw httpError('Deposit amount may have at most 2 decimal places.');
  }

  const channel = normalizePaymentChannel(paymentMethod, 'cash');
  const reference = String(paymentReference || '').trim();
  if ((channel === 'bank' || channel === 'mfs') && !reference) {
    throw httpError('Payment reference / txn ID is required for bank and MFS deposits.');
  }
  if (reference.length > 120) {
    throw httpError('Payment reference must be 120 characters or fewer.');
  }

  return {
    memberId: memberKey,
    amount: Number(numericAmount.toFixed(2)),
    paymentMethod: channel,
    paymentReference: reference,
  };
}

function resolveDepositIdempotencyKey(req) {
  return req.get?.('Idempotency-Key')
    || req.headers?.['idempotency-key']
    || req.body?.clientRequestId
    || '';
}

module.exports = {
  MAX_MANUAL_DEPOSIT_AMOUNT,
  validateManualDepositInput,
  resolveDepositIdempotencyKey,
};
