const SecurityAudit = require('../models/SecurityAudit');
const { recordAudit } = require('./securityService');

const ADMIN_ACTIONS = Object.freeze([
  'deposit_recorded',
  'withdrawal_processed',
  'withdrawal_status_updated',
  'refund_completed',
  'profit_distributed',
  'profit_pool_distributed',
  'ledger_opening_set',
  'ledger_reconciled',
  'month_target_updated',
  'dues_reminder_sent',
]);

async function recordAdminActivity({
  action,
  actor = null,
  targetUserId = null,
  targetEmail = '',
  details = {},
  ip = '',
  success = true,
}) {
  await recordAudit({
    action,
    category: 'admin',
    actorId: actor?.id || actor?._id || null,
    actorEmail: actor?.email || '',
    actorRole: actor?.role || '',
    targetUserId,
    targetEmail,
    details,
    ip,
    success,
  });
}

async function listAdminActivities({
  limit = 100,
  offset = 0,
  action = '',
  from = '',
  to = '',
} = {}) {
  const query = {
    $or: [
      { category: 'admin' },
      { action: { $in: ADMIN_ACTIONS } },
      { 'details.category': 'admin' },
    ],
  };

  if (action) query.action = action;

  const dateRange = {};
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) dateRange.$gte = fromDate;
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      dateRange.$lte = toDate;
    }
  }
  if (Object.keys(dateRange).length) query.createdAt = dateRange;

  const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const normalizedOffset = Math.max(Number(offset) || 0, 0);

  const [items, total] = await Promise.all([
    SecurityAudit.find(query)
      .sort({ createdAt: -1 })
      .skip(normalizedOffset)
      .limit(normalizedLimit)
      .lean(),
    SecurityAudit.countDocuments(query),
  ]);

  return {
    items,
    total,
    limit: normalizedLimit,
    offset: normalizedOffset,
    hasMore: normalizedOffset + items.length < total,
  };
}

module.exports = {
  ADMIN_ACTIONS,
  recordAdminActivity,
  listAdminActivities,
};
