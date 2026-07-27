const mongoose = require('mongoose');
const { ORGANIZATION_DEFAULTS } = require('../services/organizationBranding');

const OrganizationSettingsSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    default: ORGANIZATION_DEFAULTS.slug,
    index: true,
  },
  nameBn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.nameBn,
  },
  nameEn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.nameEn,
  },
  shortMarkBn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.shortMarkBn,
  },
  shortMarkEn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.shortMarkEn,
  },
  taglineBn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.taglineBn,
  },
  taglineEn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.taglineEn,
  },
  loginSubtitleBn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.loginSubtitleBn,
  },
  loginSubtitleEn: {
    type: String,
    trim: true,
    default: ORGANIZATION_DEFAULTS.loginSubtitleEn,
  },
  defaultLanguage: {
    type: String,
    enum: ['bn', 'en'],
    default: ORGANIZATION_DEFAULTS.defaultLanguage,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('OrganizationSettings', OrganizationSettingsSchema);
