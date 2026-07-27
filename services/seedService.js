const crypto = require('crypto');
const User = require('../models/User');
const { PERMISSION_KEYS, getDefaultPermissions } = require('./rbac');

function randomTempPassword() {
  return `Tmp-${crypto.randomBytes(9).toString('base64url')}`;
}

async function seedDefaultUsers() {
  const isProduction = process.env.NODE_ENV === 'production';
  const developerEmail = process.env.DEVELOPER_EMAIL || 'developer@societyhub.local';
  const developerPassword = process.env.DEVELOPER_PASSWORD
    || (isProduction ? null : 'devSecure2003');
  const ceoEmail = process.env.CEO_EMAIL || 'mdsamim62003@gmail.com';
  const ceoPassword = process.env.CEO_PASSWORD || null;
  const memberEmail = process.env.SEED_MEMBER_EMAIL || 'mdsamim62004@gmail.com';
  const memberPassword = process.env.SEED_MEMBER_PASSWORD || null;

  try {
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

    const developerExists = await User.exists({ email: developerEmail, role: 'developer' });
    if (!developerExists) {
      if (!developerPassword) {
        console.warn(
          '[seed] Skipping developer create in production — set DEVELOPER_PASSWORD (and preferably DEVELOPER_EMAIL).'
        );
      } else {
        const existingByEmail = await User.findOne({ email: developerEmail });
        if (existingByEmail) {
          existingByEmail.role = 'developer';
          existingByEmail.permissions = [...PERMISSION_KEYS];
          existingByEmail.status = 'active';
          await existingByEmail.save();
        } else {
          await User.create({
            name: 'Platform Developer',
            email: developerEmail,
            password: developerPassword,
            role: 'developer',
            permissions: [...PERMISSION_KEYS],
            savings: 0,
            profit: 0,
            status: 'active',
          });
        }
        console.log('Developer user seeded. Email:', developerEmail);
      }
    } else {
      await User.updateOne(
        { email: developerEmail },
        {
          $set: {
            role: 'developer',
            permissions: [...PERMISSION_KEYS],
            status: 'active',
          },
        }
      );
    }

    const ceoExists = await User.exists({ email: ceoEmail, role: { $in: ['ceo', 'admin'] } });
    if (!ceoExists) {
      const passwordToUse = ceoPassword || (!isProduction ? 'samim2003' : randomTempPassword());
      await User.create({
        name: 'CEO',
        email: ceoEmail,
        password: passwordToUse,
        role: 'ceo',
        permissions: ceoPerms,
        savings: 0,
        profit: 0,
      });
      if (isProduction && !ceoPassword) {
        console.warn(
          `[seed] CEO created with a one-time random password. Set CEO_PASSWORD before first deploy, or reset via User Management. Email: ${ceoEmail}`
        );
      } else {
        console.log('CEO user seeded. Email:', ceoEmail);
      }
    } else {
      await User.updateOne(
        { email: ceoEmail },
        {
          $set: {
            role: 'ceo',
            permissions: ceoPerms,
          },
        }
      );
    }

    // Never auto-seed a test member account in production with a known password.
    if (!isProduction) {
      const memberExists = await User.exists({ email: memberEmail, role: 'member' });
      if (!memberExists) {
        await User.create({
          name: 'Test Member',
          email: memberEmail,
          password: memberPassword || 'samim2004',
          role: 'member',
          permissions: getDefaultPermissions('member'),
          savings: 0,
          profit: 0,
        });
        console.log('Test member seeded. Email:', memberEmail);
      }
    }

    // Backfill empty permissions for existing users
    const usersMissingPerms = await User.find({
      $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }],
      role: { $nin: ['member'] },
    });

    for (const user of usersMissingPerms) {
      user.permissions = getDefaultPermissions(user.role);
      await user.save();
    }

    // Ensure cashiers can access Messenger chat
    const cashiers = await User.find({ role: 'cashier', status: { $ne: 'deleted' } });
    for (const cashier of cashiers) {
      const perms = Array.isArray(cashier.permissions) ? [...cashier.permissions] : [];
      let changed = false;
      ['can_manage_chat', 'can_manage_members'].forEach((key) => {
        if (!perms.includes(key)) {
          perms.push(key);
          changed = true;
        }
      });
      if (changed) {
        cashier.permissions = perms;
        await cashier.save();
      }
    }
  } catch (error) {
    console.error('Failed to seed default users:', error);
  }
}

module.exports = {
  seedDefaultUsers,
};
