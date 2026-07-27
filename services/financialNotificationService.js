const { formatMoney } = require('./moneyFormat');
const { createAdminNotification } = require('./adminNotificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { paymentChannelLabel } = require('./paymentChannelService');
const { brandingSubjectSuffix } = require('./organizationBranding');

async function notifyDepositRecorded({
  member,
  deposit,
  recordedBy = 'Cashier',
  receiptNumber = '',
  paymentMethod = 'cash',
}) {
  if (!member || !deposit) return;

  const amountLabel = `${formatMoney(Number(deposit.amount || 0), 2)}`;
  const channelLabel = paymentChannelLabel(paymentMethod);
  const receiptLabel = receiptNumber ? ` Receipt ${receiptNumber}.` : '';

  await Promise.allSettled([
    createMemberNotification({
      memberId: member._id,
      type: 'deposit',
      title: 'Deposit recorded',
      message: `Your deposit of ${amountLabel} via ${channelLabel} has been recorded.${receiptLabel}`,
      relatedId: deposit._id,
      relatedModel: 'Deposit',
    }),
    createAdminNotification({
      type: 'deposit',
      title: `Deposit from ${member.name}`,
      message: `${recordedBy} recorded ${amountLabel} for ${member.name} via ${channelLabel}.${receiptLabel}`,
      relatedId: deposit._id,
      relatedModel: 'Deposit',
    }),
    notifyMemberByEmailAndSms(member, {
      subject: `Deposit recorded — ${brandingSubjectSuffix('en')}`,
      message: `Dear ${member.name}, your deposit of ${amountLabel} via ${channelLabel} has been recorded.${receiptLabel}`,
    }),
  ]);
}

async function notifyWithdrawalEvent({
  member,
  request,
  status,
  actorName = 'Cashier',
}) {
  if (!member || !request) return;

  const amountLabel = `${formatMoney(Number(request.amount || 0), 2)}`;
  const isNew = status === 'pending';

  if (isNew) {
    await createAdminNotification({
      type: 'withdrawal',
      title: `Withdrawal request from ${member.name}`,
      message: `${member.name} requested ${amountLabel}.`,
      relatedId: request._id,
      relatedModel: 'WithdrawalRequest',
    });
    await createMemberNotification({
      memberId: member._id,
      type: 'withdrawal',
      title: 'Withdrawal request submitted',
      message: `Your withdrawal request for ${amountLabel} has been submitted and is awaiting review.`,
      relatedId: request._id,
      relatedModel: 'WithdrawalRequest',
    });
    return;
  }

  await createMemberNotification({
    memberId: member._id,
    type: 'withdrawal',
    title: `Withdrawal ${status}`,
    message: `Your withdrawal request for ${amountLabel} is now ${status}.`,
    relatedId: request._id,
    relatedModel: 'WithdrawalRequest',
  });

  await notifyMemberByEmailAndSms(member, {
    subject: `Withdrawal ${status} — ${brandingSubjectSuffix('en')}`,
    message: `Dear ${member.name}, your withdrawal request for ${amountLabel} is now ${status}.`,
  });

  if (status === 'processed') {
    await createAdminNotification({
      type: 'withdrawal',
      title: `Withdrawal processed for ${member.name}`,
      message: `${actorName} processed ${amountLabel} for ${member.name}.`,
      relatedId: request._id,
      relatedModel: 'WithdrawalRequest',
    });
  }
}

async function notifyProfitDistribution({
  members = [],
  totalAmount = 0,
  distributedBy = 'Cashier',
  distributionId = null,
}) {
  const amountLabel = `${formatMoney(Number(totalAmount || 0), 2)}`;

  await createAdminNotification({
    type: 'dividend',
    title: 'Profit distributed to members',
    message: `${distributedBy} distributed ${amountLabel} across ${members.length} member(s).`,
    relatedId: distributionId,
    relatedModel: 'ProfitDistribution',
  });

  await Promise.allSettled(members.map(async (share) => {
    const memberId = share.memberId || share.member;
    if (!memberId) return;
    const shareAmount = Number(share.share || share.amount || 0);
    await createMemberNotification({
      memberId,
      type: 'dividend',
      title: 'Profit credited',
      message: `You received a profit distribution of ${formatMoney(shareAmount, 2)}.`,
      relatedId: distributionId,
      relatedModel: 'ProfitDistribution',
    });
    if (share.memberName || share.email) {
      await notifyMemberByEmailAndSms(
        { name: share.memberName, email: share.email, phone: share.phone },
        {
          subject: `Profit distribution — ${brandingSubjectSuffix('en')}`,
          message: `Dear ${share.memberName || 'Member'}, you received a profit distribution of ${formatMoney(shareAmount, 2)}.`,
        }
      );
    }
  }));
}

module.exports = {
  notifyDepositRecorded,
  notifyWithdrawalEvent,
  notifyProfitDistribution,
};
