'use strict';

const mongoose = require('mongoose');

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || error || '');
  return /replica set|mongos|transaction numbers are only allowed|Transactions are not supported|Transaction.*not supported/i.test(message);
}

function transactionsLikelySupported() {
  try {
    const client = mongoose.connection?.getClient?.();
    const type = client?.topology?.description?.type
      || client?.topology?.s?.description?.type
      || '';
    if (!type) return true; // try; fall back if unsupported
    return !['Single', 'Unknown'].includes(String(type));
  } catch (_) {
    return true;
  }
}

/**
 * Run work inside a MongoDB transaction when supported.
 * Falls back to non-transactional execution on standalone MongoDB.
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<*>} work
 */
async function withMongoTransaction(work) {
  if (typeof work !== 'function') {
    throw new Error('withMongoTransaction requires a work function.');
  }

  if (!transactionsLikelySupported() || mongoose.connection.readyState !== 1) {
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupportedError(error)) {
      return work(null);
    }
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  withMongoTransaction,
  isTransactionUnsupportedError,
  transactionsLikelySupported,
};
