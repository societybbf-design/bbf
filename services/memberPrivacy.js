/**
 * Privacy-safe DTOs for member-facing API responses.
 * Never expose bank details, NID, passwords, or other members' PII.
 */

function toPlain(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return { ...doc };
}

function publicMemberProfile(member) {
  const plain = toPlain(member) || {};
  return {
    _id: plain._id,
    id: plain._id || plain.id,
    name: plain.name || '',
    email: plain.email || '',
    phone: plain.phone || '',
    role: plain.role || 'member',
    status: plain.status || 'active',
    savings: Number(plain.savings || 0),
    advanceBalance: Number(plain.advanceBalance || 0),
    profit: Number(plain.profit || 0),
    profilePicture: plain.profilePicture || '',
    kycStatus: plain.kycStatus || '',
    createdAt: plain.createdAt || null,
  };
}

function sanitizeInvestmentForMember(investment) {
  const plain = toPlain(investment) || {};
  const docs = Array.isArray(plain.documents)
    ? plain.documents.map((doc) => ({
      originalName: doc.originalName || doc.name || 'Document',
      // Paths intentionally omitted — download via authenticated ownership routes only
    }))
    : [];

  return {
    _id: plain._id,
    investmentCode: plain.investmentCode || '',
    title: plain.title || plain.propertyName || plain.name || 'Investment',
    propertyName: plain.propertyName || plain.title || '',
    amount: Number(plain.amount || 0),
    status: plain.status || '',
    displayStatus: plain.displayStatus || plain.status || '',
    location: plain.location || '',
    createdAt: plain.createdAt || null,
    soldAt: plain.soldAt || null,
    saleAmount: Number(plain.saleAmount || 0),
    netProfitLoss: Number(plain.netProfitLoss || 0),
    outcomeType: plain.outcomeType || '',
    eligibleMemberCount: Array.isArray(plain.eligibleMembers) ? plain.eligibleMembers.length : 0,
    approvalCount: Array.isArray(plain.approvals) ? plain.approvals.length : 0,
    documents: docs,
    // Public society labels only — no bank / investor PII
    investorName: plain.investorName || plain.investor?.name || '',
    projectManagerName: plain.projectManager?.name || plain.projectManagerName || '',
  };
}

function sanitizeInvestmentsForMember(list = []) {
  return (list || []).map(sanitizeInvestmentForMember);
}

function sanitizeGroupedInvestmentsForMember(grouped = {}) {
  return {
    all: sanitizeInvestmentsForMember(grouped.all),
    active: sanitizeInvestmentsForMember(grouped.active),
    sold: sanitizeInvestmentsForMember(grouped.sold),
    pendingMemberApproval: sanitizeInvestmentsForMember(grouped.pendingMemberApproval),
    pendingCashierPayment: sanitizeInvestmentsForMember(grouped.pendingCashierPayment),
    pending: sanitizeInvestmentsForMember(grouped.pending),
  };
}

module.exports = {
  publicMemberProfile,
  sanitizeInvestmentForMember,
  sanitizeInvestmentsForMember,
  sanitizeGroupedInvestmentsForMember,
};
