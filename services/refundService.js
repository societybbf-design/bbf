'use strict';

const { formatMoney } = require('./moneyFormat');
const Refund = require('../models/Refund');
const User = require('../models/User');
const { notifyMemberByEmailAndSms } = require('./notificationService');
const { createMemberNotification } = require('./memberNotificationService');
const { createAdminNotification } = require('./adminNotificationService');
const { recordAdminActivity } = require('./activityLogService');
const { withMongoTransaction } = require('./mongoTransaction');
const { normalizePaymentChannel } = require('./paymentChannelService');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Legacy "processing" counts as CEO-approved awaiting Cashier payout. */
function isAwaitingCashierPayout(status) {
  return status === 'approved' || status === 'processing';
}

function calculateRefundAvailability({ savings = 0, pendingAmount = 0, requestedAmount = 0 }) {
  const normalizedSavings = money(savings);
  const normalizedPending = money(pendingAmount);
  const normalizedRequested = money(requestedAmount);
  const availableAmount = Math.max(normalizedSavings - normalizedPending, 0);
  const remainingAfterRequest = money(availableAmount - normalizedRequested);
  return {
    availableAmount,
    canRequest: normalizedRequested > 0 && remainingAfterRequest >= -0.001,
    remainingAfterRequest: Math.max(0, remainingAfterRequest),
  };
}

async function getHeldRefundAmount(memberId, excludeRefundId = null) {
  const filter = {
    member: memberId,
    status: { $in: ['pending', 'approved', 'processing'] },
  };
  if (excludeRefundId) filter._id = { $ne: excludeRefundId };
  const open = await Refund.find(filter).select('amount').lean();
  return money(open.reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

async function getRefundsByMember(memberId) {
  return Refund.find({ member: memberId }).sort({ createdAt: -1 }).lean();
}

async function listCeoPendingRefunds() {
  return Refund.find({ status: 'pending' })
    .populate('member', 'name email savings')
    .sort({ createdAt: -1 })
    .lean();
}

async function listCashierRefundQueue() {
  return Refund.find({ status: { $in: ['approved', 'processing'] } })
    .populate('member', 'name email savings phone')
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * @deprecated Staff must not create refunds directly. Members request; CEO approves; Cashier pays.
 */
async function createRefund() {
  throw httpError(
    'Direct staff refund creation is disabled. Members submit refund requests; the CEO approves; only the Cashier disburses.',
    403
  );
}

async function createMemberRefundRequest({ memberId, amount, reason }) {
  const member = await User.findOne({ _id: memberId, role: 'member', status: { $ne: 'deleted' } });
  if (!member) throw httpError('Member not found.', 404);
  if (member.status === 'inactive') {
    throw httpError('Inactive members cannot submit refund requests.', 403);
  }

  const normalizedAmount = money(amount);
  if (!(normalizedAmount > 0)) {
    throw httpError('Refund amount must be greater than zero.');
  }
  if (!String(reason || '').trim()) {
    throw httpError('Please provide a reason for the refund request.');
  }

  const held = await getHeldRefundAmount(memberId);
  const availability = calculateRefundAvailability({
    savings: member.savings,
    pendingAmount: held,
    requestedAmount: normalizedAmount,
  });
  if (!availability.canRequest) {
    throw httpError(
      `Requested amount exceeds available savings. Available ${formatMoney(availability.availableAmount, 2)} (after open refund holds).`
    );
  }

  const refund = await Refund.create({
    member: memberId,
    amount: normalizedAmount,
    reason: String(reason).trim(),
    recordedBy: member.name || 'Member',
    requestedBy: 'member',
    status: 'pending',
  });

  await createAdminNotification({
    type: 'refund',
    title: `Refund request from ${member.name}`,
    message: `${member.name} requested a refund of ${formatMoney(normalizedAmount, 2)}. Reason: ${refund.reason}`,
    relatedId: refund._id,
    relatedModel: 'Refund',
    targetRoles: ['ceo'],
  });

  await createMemberNotification({
    memberId: member._id,
    type: 'refund',
    title: 'Refund request submitted',
    message: `Your refund request for ${formatMoney(normalizedAmount, 2)} is awaiting CEO review.`,
    relatedId: refund._id,
    relatedModel: 'Refund',
  });

  return { refund, availability };
}

async function approveRefund(refundId, { reviewedBy = 'CEO', adminNote = '' } = {}) {
  const refund = await Refund.findOneAndUpdate(
    { _id: refundId, status: 'pending' },
    {
      $set: {
        status: 'approved',
        reviewedBy: String(reviewedBy || 'CEO').trim(),
        reviewedAt: new Date(),
        adminNote: String(adminNote || '').trim(),
      },
    },
    { new: true }
  );
  if (!refund) {
    const existing = await Refund.findById(refundId);
    if (!existing) throw httpError('Refund record not found.', 404);
    throw httpError('Only pending member refund requests can be approved.', 409);
  }

  const member = await User.findById(refund.member).select('name email phone');
  if (member) {
    await createMemberNotification({
      memberId: member._id,
      type: 'refund',
      title: 'Refund approved',
      message: `Your refund of ${formatMoney(Number(refund.amount), 2)} was approved by the CEO and sent to the Cashier for payout.`,
      relatedId: refund._id,
      relatedModel: 'Refund',
    });
    await notifyMemberByEmailAndSms(member, {
      subject: 'Refund Approved',
      message: `Dear ${member.name}, your refund of ${formatMoney(Number(refund.amount), 2)} was approved and is awaiting Cashier disbursement.`,
    });
  }

  await createAdminNotification({
    type: 'refund',
    title: `Refund ready for Cashier payout`,
    message: `CEO approved refund of ${formatMoney(Number(refund.amount), 2)} for ${member?.name || 'member'}.`,
    relatedId: refund._id,
    relatedModel: 'Refund',
    targetRoles: ['cashier'],
  });

  return refund;
}

async function rejectRefund(refundId, { reviewedBy = 'CEO', adminNote = '' } = {}) {
  const refund = await Refund.findOneAndUpdate(
    { _id: refundId, status: 'pending' },
    {
      $set: {
        status: 'rejected',
        reviewedBy: String(reviewedBy || 'CEO').trim(),
        reviewedAt: new Date(),
        adminNote: String(adminNote || 'Rejected by CEO').trim(),
      },
    },
    { new: true }
  );
  if (!refund) {
    const existing = await Refund.findById(refundId);
    if (!existing) throw httpError('Refund record not found.', 404);
    throw httpError('Only pending member refund requests can be rejected.', 409);
  }

  const member = await User.findById(refund.member).select('name email phone');
  if (member) {
    await createMemberNotification({
      memberId: member._id,
      type: 'refund',
      title: 'Refund rejected',
      message: `Your refund request for ${formatMoney(Number(refund.amount), 2)} was rejected.${refund.adminNote ? ` Note: ${refund.adminNote}` : ''}`,
      relatedId: refund._id,
      relatedModel: 'Refund',
    });
    await notifyMemberByEmailAndSms(member, {
      subject: 'Refund Rejected',
      message: `Dear ${member.name}, your refund request for ${formatMoney(Number(refund.amount), 2)} was rejected.`,
    });
  }

  return refund;
}

/**
 * Cashier-only payout: debit society bank ledger + member savings atomically.
 */
async function processRefundPayout(refundId, {
  processedBy = 'Cashier',
  paymentMethod = 'cash',
  disbursementReference = '',
  adminNote = '',
  actor = null,
  ip = '',
} = {}) {
  const { debit, creditInbound } = require('./bankLedgerService');

  const claimed = await Refund.findOneAndUpdate(
    { _id: refundId, status: { $in: ['approved', 'processing'] } },
    {
      $set: {
        status: 'processing',
        processedBy: String(processedBy || 'Cashier').trim(),
        paymentMethod: normalizePaymentChannel(paymentMethod, 'cash'),
        disbursementReference: String(disbursementReference || '').trim(),
      },
    },
    { new: true }
  );

  if (!claimed) {
    const existing = await Refund.findById(refundId);
    if (!existing) throw httpError('Refund record not found.', 404);
    if (existing.status === 'completed') {
      throw httpError('This refund was already paid out.', 409);
    }
    throw httpError('Only CEO-approved refunds can be paid by the Cashier.', 409);
  }

  let bankDebit = null;
  const amount = money(claimed.amount);

  try {
    const result = await withMongoTransaction(async (session) => {
      const memberQuery = User.findById(claimed.member);
      if (session) memberQuery.session(session);
      const member = await memberQuery;
      if (!member || member.role !== 'member' || member.status === 'deleted') {
        throw httpError('Member not found for this refund.', 404);
      }

      const savingsBefore = money(member.savings);
      if (savingsBefore + 0.001 < amount) {
        throw httpError(
          `Insufficient member savings for payout. Balance ${formatMoney(savingsBefore, 2)}; refund ${formatMoney(amount, 2)}.`
        );
      }

      bankDebit = await debit({
        type: 'member_refund',
        amount,
        referenceType: 'Refund',
        referenceId: claimed._id,
        note: `Member refund payout to ${member.name}${claimed.reason ? ` — ${claimed.reason}` : ''}`,
        createdBy: processedBy,
        paymentChannel: normalizePaymentChannel(paymentMethod, 'cash'),
        paymentReference: String(disbursementReference || '').trim(),
      });

      member.savings = money(Math.max(0, savingsBefore - amount));
      await member.save(session ? { session } : undefined);

      const completed = await Refund.findOneAndUpdate(
        { _id: claimed._id, status: 'processing' },
        {
          $set: {
            status: 'completed',
            processedAt: new Date(),
            processedBy: String(processedBy || 'Cashier').trim(),
            paymentMethod: normalizePaymentChannel(paymentMethod, 'cash'),
            disbursementReference: String(disbursementReference || '').trim(),
            bankLedgerEntryId: bankDebit?.entry?._id || null,
            ...(adminNote ? { adminNote: String(adminNote).trim() } : {}),
          },
        },
        { new: true, ...(session ? { session } : {}) }
      );
      if (!completed) {
        throw httpError('Refund payout claim was lost during completion.', 409);
      }

      return { refund: completed, member, bankDebit };
    });

    const { refund, member } = result;
    await createMemberNotification({
      memberId: member._id,
      type: 'refund',
      title: 'Refund paid',
      message: `Your refund of ${formatMoney(amount, 2)} has been paid by the Cashier.`,
      relatedId: refund._id,
      relatedModel: 'Refund',
    });
    await notifyMemberByEmailAndSms(member, {
      subject: 'Refund Completed',
      message: `Dear ${member.name}, your refund of ${formatMoney(amount, 2)} has been disbursed.`,
    });
    await createAdminNotification({
      type: 'refund',
      title: `Refund completed for ${member.name}`,
      message: `Cashier paid refund of ${formatMoney(amount, 2)}.`,
      relatedId: refund._id,
      relatedModel: 'Refund',
      targetRoles: ['ceo', 'cashier'],
    });
    await recordAdminActivity({
      action: 'refund_completed',
      actor: actor || null,
      targetUserId: member._id,
      details: {
        amount: refund.amount,
        refundId: refund._id,
        paymentMethod: refund.paymentMethod,
        bankLedgerEntryId: refund.bankLedgerEntryId,
      },
      ip: ip || '',
    });

    return {
      refund,
      bankLedger: { debit: result.bankDebit },
      message: `Refund of ${formatMoney(amount, 2)} paid. Member savings and bank ledger updated.`,
    };
  } catch (error) {
    if (bankDebit) {
      try {
        await creditInbound({
          type: 'deposit',
          amount,
          referenceType: 'Refund',
          referenceId: claimed._id,
          note: `Rollback member refund payout`,
          createdBy: processedBy,
        });
      } catch (_) { /* keep original */ }
    }
    // Release claim back to approved so Cashier can retry.
    await Refund.updateOne(
      { _id: claimed._id, status: 'processing' },
      { $set: { status: 'approved' } }
    ).catch(() => {});
    throw error;
  }
}

/**
 * Legacy PATCH bridge — only CEO approve/reject or Cashier complete via status mapping.
 * Prefer explicit approve/reject/cashier-complete endpoints.
 */
async function updateRefundStatus(refundId, status, adminNote = '', options = {}) {
  if (status === 'approved' || status === 'processing') {
    // "processing" from old inbox = approve for CEO path
    if (options.role === 'cashier' && status === 'processing') {
      throw httpError('Cashier cannot approve refunds. Wait for CEO approval, then complete payout.', 403);
    }
    return approveRefund(refundId, {
      reviewedBy: options.actorName || 'CEO',
      adminNote,
    });
  }
  if (status === 'rejected') {
    return rejectRefund(refundId, {
      reviewedBy: options.actorName || 'CEO',
      adminNote,
    });
  }
  if (status === 'completed') {
    if (options.role && options.role !== 'cashier') {
      throw httpError('Only the Cashier can disburse approved refunds.', 403);
    }
    const result = await processRefundPayout(refundId, {
      processedBy: options.actorName || 'Cashier',
      paymentMethod: options.paymentMethod || 'cash',
      disbursementReference: options.disbursementReference || '',
      adminNote,
      actor: options.actor || null,
      ip: options.ip || '',
    });
    return result.refund;
  }
  throw httpError('Invalid refund status transition.');
}

async function updateRefundStatusWithAudit(refundId, status, adminNote = '', options = {}) {
  return updateRefundStatus(refundId, status, adminNote, options);
}

module.exports = {
  money,
  calculateRefundAvailability,
  getHeldRefundAmount,
  isAwaitingCashierPayout,
  createRefund,
  createMemberRefundRequest,
  getRefundsByMember,
  listCeoPendingRefunds,
  listCashierRefundQueue,
  approveRefund,
  rejectRefund,
  processRefundPayout,
  updateRefundStatus,
  updateRefundStatusWithAudit,
};
