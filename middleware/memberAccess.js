const User = require('../models/User');
const { requireAuth } = require('./auth');

/**
 * Active society member only — uses live DB status (not just session role).
 * Blocks inactive/deleted members from financial actions.
 */
function requireActiveMember(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.session?.user?.role !== 'member') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    User.findById(req.session.user.id)
      .select('status role name')
      .then((member) => {
        if (!member || member.role !== 'member') {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (member.status === 'inactive') {
          return res.status(403).json({ error: 'Your account is inactive. Please contact the admin.' });
        }
        if (member.status === 'deleted') {
          return res.status(403).json({ error: 'Your account has been removed from the society.' });
        }
        req.memberRecord = member;
        return next();
      })
      .catch(() => res.status(500).json({ error: 'Unable to verify member access.' }));
  });
}

module.exports = {
  requireActiveMember,
};
