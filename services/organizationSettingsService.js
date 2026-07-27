const OrganizationSettings = require('../models/OrganizationSettings');
const {
  ORGANIZATION_DEFAULTS,
  setCachedOrganizationSettings,
} = require('./organizationBranding');

async function ensureOrganizationSettings() {
  let settings = await OrganizationSettings.findOne({ slug: ORGANIZATION_DEFAULTS.slug });
  if (!settings) {
    settings = await OrganizationSettings.create({ ...ORGANIZATION_DEFAULTS });
    console.log('[seed] Organization settings created for', settings.nameBn);
  }
  setCachedOrganizationSettings(settings.toObject());
  return settings;
}

module.exports = {
  ensureOrganizationSettings,
};
