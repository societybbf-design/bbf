const router = require('express').Router();
const { requireActiveMember } = require('../middleware/memberAccess');

router.use(requireActiveMember);

/**
 * Member self-service deposits are disabled.
 * Only staff with can_manage_deposits may credit savings via /api/admin/deposits.
 */
router.post('/', async (req, res) => {
  return res.status(403).json({
    error: 'Deposits must be recorded by the cashier at the society office. Self-service deposits are disabled.',
  });
});

module.exports = router;
