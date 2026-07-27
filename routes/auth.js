const router = require('express').Router();
const User = require('../models/User');
const { publicUserPayload } = require('../services/rbac');
const {
  assertCanLogin,
  clearExpiredLock,
  registerFailedLogin,
  registerSuccessfulLogin,
  requestPasswordOtp,
  changeOwnPassword,
  clientIp,
} = require('../services/securityService');
const { requireAuth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const users = await User.find({ email: String(email).toLowerCase().trim() });
    if (!users.length) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const ip = clientIp(req);
    let authenticatedUser = null;
    let matchedByPassword = null;

    for (const candidate of users) {
      await clearExpiredLock(candidate);
      const valid = await candidate.comparePassword(password);
      if (valid) {
        matchedByPassword = candidate;
        break;
      }
    }

    if (!matchedByPassword) {
      // Increment failed attempts on the primary matching email account
      const primary = users[0];
      const result = await registerFailedLogin(primary, { ip });
      if (result.lockedNow) {
        return res.status(423).json({
          error: 'Account locked for 24 hours after too many failed login attempts. Request a password reset OTP and contact the Developer.',
          locked: true,
        });
      }
      const remaining = Math.max(0, (Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5) - result.attempts);
      return res.status(401).json({
        error: remaining > 0
          ? `Invalid credentials. ${remaining} attempt(s) remaining before lockout.`
          : 'Invalid credentials.',
        attemptsRemaining: remaining,
      });
    }

    const gate = assertCanLogin(matchedByPassword);
    if (!gate.ok) {
      return res.status(gate.status).json({ error: gate.error, locked: Boolean(gate.locked) });
    }

    authenticatedUser = matchedByPassword;
    await registerSuccessfulLogin(authenticatedUser, { ip });

    const payload = publicUserPayload(authenticatedUser);
    const sessionUser = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      permissions: payload.permissions,
    };

    // Rotate session ID on login to prevent session fixation.
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.user = sessionUser;

    return res.json({
      user: {
        ...req.session.user,
        redirectTo: payload.redirectTo,
      },
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  // Session-only teardown — never mutates User documents or transaction data
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.clearCookie('society.sid');
    return res.json({ message: 'Logged out.' });
  });
});

router.post('/request-password-otp', async (req, res) => {
  try {
    const result = await requestPasswordOtp(req.body?.email, { ip: clientIp(req) });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to request OTP.' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const result = await changeOwnPassword(
      req.session.user.id,
      {
        currentPassword: req.body?.currentPassword,
        newPassword: req.body?.newPassword,
      },
      { ip: clientIp(req) }
    );
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to change password.' });
  }
});

router.post('/confirm-password', requireAuth, async (req, res) => {
  try {
    const UserModel = require('../models/User');
    const user = await UserModel.findById(req.session.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const ok = await user.comparePassword(req.body?.password || '');
    if (!ok) {
      return res.status(401).json({ error: 'Password confirmation failed.', confirmed: false });
    }
    return res.json({ confirmed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to confirm password.' });
  }
});

module.exports = router;
