#!/usr/bin/env node
/**
 * Production / pre-launch database wipe.
 *
 * Drops every MongoDB collection EXCEPT developer login accounts
 * (role === 'developer'). Sessions are cleared. Organization settings
 * and investment types are re-seeded for a clean boot.
 *
 * Usage:
 *   MONGO_URI=... node scripts/reset-database.js --confirm
 *   RESET_DB_CONFIRM=YES MONGO_URI=... npm run db:reset:confirm
 *
 * Prefer SEED_ONLY_DEVELOPER=1 in Hostinger env after wipe so CEO/cashier
 * /member demo accounts are not recreated on restart.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { wipeTransactionalDatabase } = require('../services/databaseResetService');

const mongoUri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
const confirmed = process.argv.includes('--confirm')
  || String(process.env.RESET_DB_CONFIRM || '').toUpperCase() === 'YES';

function maskUri(uri) {
  return String(uri || '').replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
}

async function main() {
  if (!mongoUri) {
    console.error('Missing MONGO_URI (or MONGODB_URI). Aborting.');
    process.exit(1);
  }
  if (!confirmed) {
    console.error('Refusing to wipe without --confirm (or RESET_DB_CONFIRM=YES).');
    console.error(`Target would be: ${maskUri(mongoUri)}`);
    process.exit(1);
  }

  console.log(`[reset-db] Connecting to ${maskUri(mongoUri)}`);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

  const result = await wipeTransactionalDatabase({
    reseedBasics: true,
    actorLabel: 'cli:reset-database',
  });

  console.log(`[reset-db] Dropped ${result.collectionCount} collection(s).`);
  if (result.developersPreserved) {
    console.log(`[reset-db] Restored ${result.developersPreserved} developer user(s):`);
    (result.developerEmails || []).forEach((email) => console.log(`  - ${email}`));
  } else {
    console.warn(
      '[reset-db] No developer users were found to preserve. '
      + 'ensureDeveloperUser will create one if DEVELOPER_PASSWORD is set.'
    );
  }
  console.log('[reset-db]', result.message);
  console.log('[reset-db] Set SEED_ONLY_DEVELOPER=1 on Hostinger to keep only the developer login after restart.');

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('[reset-db] FAILED:', error.message || error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
