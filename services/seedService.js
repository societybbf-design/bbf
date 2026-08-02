const crypto = require('crypto');
const User = require('../models/User');
const {
  getDefaultPermissions,
  CASHIER_EXCLUSIVE_PERMISSIONS,
  PROJECT_MANAGER_BLOCKED_PERMISSIONS,
} = require('./rbac');

function randomTempPassword() {
  return `Tmp-${crypto.randomBytes(9).toString('base64url')}`;
}

function envFlag(name) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Ensure the platform developer account exists / stays active.
 * Never overwrites an existing password hash.
 */
async function ensureDeveloperUser() {
  const isProduction = process.env.NODE_ENV === 'production';
  const developerEmail = (
    process.env.DEVELOPER_EMAIL || 'developer@bondhutto-bandhon.foundation'
  ).toLowerCase().trim();
  const developerPassword = process.env.DEVELOPER_PASSWORD
    || (isProduction ? null : 'devSecure2003');

  const existingDev = await User.findOne({ role: 'developer', email: developerEmail });
  if (existingDev) {
    await User.updateOne(
      { _id: existingDev._id },
      {
        $set: {
          role: 'developer',
          permissions: getDefaultPermissions('developer'),
          status: 'active',
        },
      }
    );
    return existingDev;
  }

  // Any developer role (different email) — keep them, do not create a second account.
  const anyDeveloper = await User.findOne({ role: 'developer', status: { $ne: 'deleted' } });
  if (anyDeveloper) {
    await User.updateOne(
      { _id: anyDeveloper._id },
      {
        $set: {
          permissions: getDefaultPermissions('developer'),
          status: 'active',
        },
      }
    );
    return anyDeveloper;
  }

  if (!developerPassword) {
    console.warn(
      '[seed] No developer account found and DEVELOPER_PASSWORD is unset in production — skipping create.'
    );
    return null;
  }

  const existingByEmail = await User.findOne({ email: developerEmail });
  if (existingByEmail) {
    existingByEmail.role = 'developer';
    existingByEmail.permissions = getDefaultPermissions('developer');
    existingByEmail.status = 'active';
    await existingByEmail.save();
    console.log('Developer role applied to existing user. Email:', developerEmail);
    return existingByEmail;
  }

  const created = await User.create({
    name: 'Platform Developer',
    email: developerEmail,
    password: developerPassword,
    role: 'developer',
    permissions: getDefaultPermissions('developer'),
    savings: 0,
    profit: 0,
    status: 'active',
  });
  console.log('Developer user seeded. Email:', developerEmail);
  return created;
}

async function ensureCeoUser() {
  const isProduction = process.env.NODE_ENV === 'production';
  const onlyDeveloper = envFlag('SEED_ONLY_DEVELOPER');
  // Fresh / production-clean mode: do not auto-create CEO.
  if (onlyDeveloper) return null;

  const ceoEmail = (process.env.CEO_EMAIL || '').toLowerCase().trim();
  const ceoPassword = process.env.CEO_PASSWORD || null;
  // Require an explicit CEO_EMAIL (and in production, CEO_PASSWORD) before creating.
  if (!ceoEmail) {
    return null;
  }
  if (isProduction && !ceoPassword && !envFlag('SEED_CEO')) {
    console.warn('[seed] CEO_EMAIL set but CEO_PASSWORD missing in production — skipping CEO create.');
    return null;
  }
  if (!isProduction && !ceoPassword && !envFlag('SEED_CEO')) {
    // Dev convenience: only seed CEO when explicitly requested or password provided.
    if (!envFlag('SEED_CEO')) return null;
  }

  const ceoPerms = getDefaultPermissions('ceo');
  const existing = await User.findOne({ email: ceoEmail });
  if (existing) {
    if (existing.role !== 'ceo' && existing.role !== 'admin' && existing.role !== 'developer') {
      existing.role = 'ceo';
      existing.permissions = ceoPerms;
      await existing.save();
      console.log('Existing user promoted to CEO. Email:', ceoEmail);
    } else if (existing.role === 'admin' || existing.role === 'ceo') {
      await User.updateOne(
        { _id: existing._id },
        { $set: { role: 'ceo', permissions: ceoPerms } }
      );
    }
    return existing;
  }

  const passwordToUse = ceoPassword || (!isProduction ? randomTempPassword() : randomTempPassword());
  await User.create({
    name: 'CEO',
    email: ceoEmail,
    password: passwordToUse,
    role: 'ceo',
    permissions: ceoPerms,
    savings: 0,
    profit: 0,
  });
  console.log('CEO user seeded. Email:', ceoEmail);
  return true;
}

async function ensureOptionalTestMember() {
  if (process.env.NODE_ENV === 'production') return null;
  if (envFlag('SEED_ONLY_DEVELOPER')) return null;
  if (!envFlag('SEED_MEMBER')) return null;

  const memberEmail = (
    process.env.SEED_MEMBER_EMAIL || process.env.MEMBER_EMAIL || ''
  ).toLowerCase().trim();
  const memberPassword = process.env.SEED_MEMBER_PASSWORD || process.env.MEMBER_PASSWORD || null;
  if (!memberEmail || !memberPassword) {
    console.warn('[seed] SEED_MEMBER=1 but SEED_MEMBER_EMAIL/PASSWORD missing — skipping.');
    return null;
  }

  const memberExists = await User.exists({ email: memberEmail });
  if (memberExists) return null;

  await User.create({
    name: 'Test Member',
    email: memberEmail,
    password: memberPassword,
    role: 'member',
    permissions: getDefaultPermissions('member'),
    savings: 0,
    profit: 0,
  });
  console.log('Test member seeded. Email:', memberEmail);
  return true;
}

async function backfillStaffPermissions() {
  // Migrate legacy admin accounts to CEO with operational permissions
  const ceoPerms = getDefaultPermissions('ceo');
  await User.updateMany(
    { role: 'admin' },
    {
      $set: {
        role: 'ceo',
        permissions: ceoPerms,
      },
    }
  );

  const usersMissingPerms = await User.find({
    $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }],
    role: { $nin: ['member'] },
  });

  for (const user of usersMissingPerms) {
    user.permissions = getDefaultPermissions(user.role);
    await user.save();
  }

  const cashiers = await User.find({ role: 'cashier', status: { $ne: 'deleted' } });
  for (const cashier of cashiers) {
    let perms = Array.isArray(cashier.permissions) ? [...cashier.permissions] : [];
    let changed = false;
    ['can_manage_chat', 'can_manage_members', 'can_disburse_loans', 'can_manage_profit', 'can_manage_deposits'].forEach((key) => {
      if (!perms.includes(key)) {
        perms.push(key);
        changed = true;
      }
    });
    if (perms.includes('can_manage_loans')) {
      perms = perms.filter((key) => key !== 'can_manage_loans');
      changed = true;
    }
    if (changed) {
      cashier.permissions = perms;
      await cashier.save();
    }
  }

  const nonCashiers = await User.find({
    role: { $nin: ['cashier', 'member'] },
    status: { $ne: 'deleted' },
    permissions: { $in: [...CASHIER_EXCLUSIVE_PERMISSIONS] },
  });
  for (const user of nonCashiers) {
    user.permissions = (user.permissions || []).filter(
      (key) => !CASHIER_EXCLUSIVE_PERMISSIONS.includes(key)
    );
    await user.save();
  }

  await User.updateMany(
    { role: 'project_manager', permissions: 'can_manage_loans' },
    { $pull: { permissions: 'can_manage_loans' } }
  );

  const pmsWithBlocked = await User.find({
    role: 'project_manager',
    status: { $ne: 'deleted' },
    permissions: { $in: [...PROJECT_MANAGER_BLOCKED_PERMISSIONS] },
  });
  for (const user of pmsWithBlocked) {
    user.permissions = (user.permissions || []).filter(
      (key) => !PROJECT_MANAGER_BLOCKED_PERMISSIONS.includes(key)
    );
    await user.save();
  }
}

async function seedDefaultUsers() {
  try {
    await ensureDeveloperUser();
    await ensureCeoUser();
    await ensureOptionalTestMember();
    await backfillStaffPermissions();
  } catch (error) {
    console.error('Failed to seed default users:', error);
  }
}

module.exports = {
  seedDefaultUsers,
  ensureDeveloperUser,
};
