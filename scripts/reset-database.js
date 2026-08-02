#!/usr/bin/env node
/**
 * Production / pre-launch database wipe.
 *
 * Drops every MongoDB collection EXCEPT developer login accounts
 * (role === 'developer'). Sessions are cleared. On next app boot,
 * organization settings + investment types are re-seeded; with
 * SEED_ONLY_DEVELOPER=1 (default for this script's companion env),
 * only the developer account remains.
 *
 * Usage:
 *   MONGO_URI=... node scripts/reset-database.js
 *   MONGO_URI=... node scripts/reset-database.js --confirm
 *
 * Safety: requires --confirm (or RESET_DB_CONFIRM=YES) so it cannot
 * be run accidentally.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

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
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).sort();
  console.log(`[reset-db] Found ${names.length} collection(s): ${names.join(', ') || '(none)'}`);

  // Preserve developer credentials (password hash, email, name).
  let preservedDevelopers = [];
  if (names.includes('users')) {
    const users = db.collection('users');
    preservedDevelopers = await users.find({ role: 'developer' }).toArray();
    console.log(`[reset-db] Preserving ${preservedDevelopers.length} developer account(s).`);
  }

  for (const name of names) {
    try {
      await db.dropCollection(name);
      console.log(`[reset-db] Dropped collection: ${name}`);
    } catch (error) {
      // NamespaceNotFound is fine if another process raced.
      if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) {
        console.warn(`[reset-db] Could not drop ${name}:`, error.message);
      }
    }
  }

  if (preservedDevelopers.length) {
    // Strip Mongo internal fields that could conflict on re-insert.
    const docs = preservedDevelopers.map((doc) => {
      const copy = { ...doc };
      // Keep _id so sessions / bookmarks to the same account remain valid if any linger.
      return copy;
    });
    await db.collection('users').insertMany(docs);
    console.log(`[reset-db] Restored ${docs.length} developer user(s):`);
    docs.forEach((d) => {
      console.log(`  - ${d.email || d._id} (${d.name || 'unnamed'})`);
    });
  } else {
    console.warn(
      '[reset-db] No developer users were found to preserve. '
      + 'On next boot, seedDefaultUsers will create one if DEVELOPER_PASSWORD is set.'
    );
  }

  await mongoose.disconnect();
  console.log('[reset-db] Done. Database is empty except preserved developer login(s).');
  console.log('[reset-db] Start the app with SEED_ONLY_DEVELOPER=1 to avoid re-creating demo CEO/member accounts.');
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
