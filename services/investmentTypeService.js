const InvestmentType = require('../models/InvestmentType');

const DEFAULT_TYPES = [
  { name: 'Fixed Investment', key: 'fixed', description: 'Long-term fixed commitment', sortOrder: 1 },
  { name: 'Temporary Investment', key: 'temporary', description: 'Short-term or revolving investment', sortOrder: 2 },
  { name: 'Equity Investment', key: 'equity', description: 'Ownership / equity participation', sortOrder: 3 },
  { name: 'Joint Venture', key: 'joint_venture', description: 'Shared project investment', sortOrder: 4 },
  { name: 'Other', key: 'other', description: 'Custom or unclassified investment', sortOrder: 99 },
];

function slugifyTypeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || `type_${Date.now()}`;
}

async function ensureDefaultInvestmentTypes() {
  for (const type of DEFAULT_TYPES) {
    await InvestmentType.updateOne(
      { key: type.key },
      {
        $setOnInsert: {
          name: type.name,
          key: type.key,
          description: type.description,
          sortOrder: type.sortOrder,
          isActive: true,
        },
      },
      { upsert: true }
    );
  }
}

async function listInvestmentTypes({ includeInactive = false } = {}) {
  await ensureDefaultInvestmentTypes();
  const query = includeInactive ? {} : { isActive: true };
  return InvestmentType.find(query).sort({ sortOrder: 1, name: 1 }).lean();
}

async function createInvestmentType({ name, description = '' }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    const error = new Error('Investment type name is required.');
    error.status = 400;
    throw error;
  }

  const existing = await InvestmentType.findOne({
    $or: [
      { name: normalizedName },
      { key: slugifyTypeName(normalizedName) },
    ],
  });

  if (existing) {
    if (!existing.isActive) {
      existing.isActive = true;
      existing.description = description?.trim() || existing.description;
      await existing.save();
      return existing;
    }
    const error = new Error('This investment type already exists.');
    error.status = 409;
    throw error;
  }

  return InvestmentType.create({
    name: normalizedName,
    key: slugifyTypeName(normalizedName),
    description: String(description || '').trim(),
    isActive: true,
    sortOrder: 50,
  });
}

module.exports = {
  DEFAULT_TYPES,
  ensureDefaultInvestmentTypes,
  listInvestmentTypes,
  createInvestmentType,
  slugifyTypeName,
};
