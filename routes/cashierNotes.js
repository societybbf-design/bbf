'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getPadForUser, savePadForUser } = require('../services/cashierNotesService');

router.use(requireAuth);

/** Personal Cashier notes pad — available to any authenticated staff session. */
router.get('/', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.session?.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const pad = await getPadForUser(userId);
    return res.json(pad);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to load notes.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.session?.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const pad = await savePadForUser(userId, {
      notes: req.body?.notes,
      tasks: req.body?.tasks,
      fabPosition: req.body?.fabPosition,
    });
    return res.json(pad);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Unable to save notes.' });
  }
});

module.exports = router;
