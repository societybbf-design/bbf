const router = require('express').Router();
const { getBrandingPayload, normalizeLanguage } = require('../services/organizationBranding');

router.get('/', (req, res) => {
  const language = normalizeLanguage(req.query.lang || req.session?.user?.preferredLanguage);
  return res.json(getBrandingPayload(language));
});

module.exports = router;
