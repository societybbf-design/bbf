const { formatMoney } = require('./moneyFormat');
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

  await notifyMemberByEmailAndSms(member, {
    subject: `Deposit recorded — ${brandingSubjectSuffix('en')}`,
    message: `Dear ${member.name}, your deposit of ${amountLabel} via ${channelLabel} has been recorded.${receiptLabel}`,
  });
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
    return;
  }

  await notifyMemberByEmailAndSms(member, {
    subject: `Withdrawal ${status} — ${brandingSubjectSuffix('en')}`,
    message: `Dear ${member.name}, your withdrawal request for ${amountLabel} is now ${status}.`,
  });
}

async function notifyProfitDistribution({
  members = [],
  totalAmount = 0,
  distributedBy = 'Cashier',
  distributionId = null,
}) {
  await Promise.allSettled(members.map(async (share) => {
    const shareAmount = Number(share.share || share.amount || 0);
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
