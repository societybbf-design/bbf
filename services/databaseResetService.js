'use strict';

const mongoose = require('mongoose');

const WIPE_CONFIRM_PHRASE = 'WIPE_ALL_DATA';

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Drop every MongoDB collection, then restore developer login accounts only.
 * Optionally re-seeds organization settings + investment types so the app boots cleanly.
 *
 * @param {{ reseedBasics?: boolean, actorLabel?: string }} [options]
 */
async function wipeTransactionalDatabase({
  reseedBasics = true,
  actorLabel = 'system',
} = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw httpError('Database is not connected.', 503);
  }

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).sort();

  let preservedDevelopers = [];
  if (names.includes('users')) {
    preservedDevelopers = await db.collection('users').find({ role: 'developer' }).toArray();
  }

  const dropped = [];
  for (const name of names) {
    try {
      await db.dropCollection(name);
      dropped.push(name);
    } catch (error) {
      if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) {
        throw error;
      }
    }
  }

  let restoredDevelopers = 0;
  if (preservedDevelopers.length) {
    const docs = preservedDevelopers.map((doc) => ({ ...doc }));
    await db.collection('users').insertMany(docs);
    restoredDevelopers = docs.length;
  }

  let basics = null;
  if (reseedBasics) {
    const { ensureDeveloperUser } = require('./seedService');
    const { ensureDefaultInvestmentTypes } = require('./investmentTypeService');
    const { ensureOrganizationSettings } = require('./organizationSettingsService');
    await ensureDeveloperUser();
    await ensureDefaultInvestmentTypes();
    await ensureOrganizationSettings();
    basics = {
      organizationSettings: true,
      investmentTypes: true,
      developerEnsured: true,
    };
  }

  return {
    message: 'Database wiped. Only developer login accounts remain. Balances and trial data are cleared.',
    actorLabel: String(actorLabel || 'system'),
    collectionsDropped: dropped,
    collectionCount: dropped.length,
    developersPreserved: restoredDevelopers,
    developerEmails: preservedDevelopers.map((d) => d.email).filter(Boolean),
    basics,
  };
}

module.exports = {
  WIPE_CONFIRM_PHRASE,
  wipeTransactionalDatabase,
};
