const { formatMoney } = require('./moneyFormat');
const { brandingSubjectSuffix } = require('./organizationBranding');
const MonthlyContributionDue = require('../models/MonthlyContributionDue');
const User = require('../models/User');
const { yearMonthFromDate } = require('./monthlyTargetService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { recordAdminActivity } = require('./activityLogService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

async function listMembersNeedingReminder({ yearMonth = null } = {}) {
  const month = yearMonth || yearMonthFromDate();
  const dues = await MonthlyContributionDue.find({
    yearMonth: month,
    status: { $in: ['unpaid', 'partial'] },
    unpaidAmount: { $gt: 0 },
  })
    .populate('member', 'name email phone status')
    .sort({ unpaidAmount: -1 })
    .lean();

  return dues
    .filter((due) => due.member && due.member.status === 'active')
    .map((due) => ({
      dueId: due._id,
      memberId: due.member._id,
      memberName: due.memberName || due.member.name,
      email: due.member.email,
      phone: due.member.phone,
      yearMonth: due.yearMonth,
      expectedAmount: money(due.expectedAmount),
      paidAmount: money(due.paidAmount),
      unpaidAmount: money(due.unpaidAmount),
      status: due.status,
      lastRemindedAt: due.lastRemindedAt || null,
    }));
}

async function sendDuesReminders({
  yearMonth = null,
  memberIds = [],
  actor = null,
  channel = 'all',
} = {}) {
  const month = yearMonth || yearMonthFromDate();
  let targets = await listMembersNeedingReminder({ yearMonth: month });

  if (memberIds.length) {
    const idSet = new Set(memberIds.map(String));
    targets = targets.filter((item) => idSet.has(String(item.memberId)));
  }

  const results = [];
  for (const target of targets) {
    const message = `Your ${month} society contribution of ${formatMoney(target.unpaidAmount, 2)} is still outstanding. Please deposit at your earliest convenience.`;

    const member = await User.findById(target.memberId).select('name email phone');
    if (!member) continue;

    if (channel === 'all' || channel === 'in_app') {
      await createMemberNotification({
        memberId: member._id,
        type: 'general',
        title: 'Monthly dues reminder',
        message,
        relatedId: target.dueId,
        relatedModel: 'MonthlyContributionDue',
      });
    }

    if (channel === 'all' || channel === 'sms_email') {
      await notifyMemberByEmailAndSms(member, {
        subject: `Monthly dues reminder — ${brandingSubjectSuffix('en')}`,
        message: `Dear ${member.name}, ${message}`,
      });
    }

    await MonthlyContributionDue.updateOne(
      { _id: target.dueId },
      { $set: { lastRemindedAt: new Date() } }
    );

    results.push({
      memberId: member._id,
      memberName: member.name,
      unpaidAmount: target.unpaidAmount,
      yearMonth: month,
    });
  }

  if (actor) {
    await recordAdminActivity({
      action: 'dues_reminder_sent',
      actor,
      details: {
        yearMonth: month,
        recipientCount: results.length,
        channel,
      },
    });
  }

  return {
    yearMonth: month,
    sentCount: results.length,
    recipients: results,
  };
}

module.exports = {
  listMembersNeedingReminder,
  sendDuesReminders,
};
