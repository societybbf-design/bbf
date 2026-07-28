const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ALL_ROLES, getDefaultPermissions } = require('../services/rbac');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ALL_ROLES,
    default: 'member',
    index: true,
  },
  permissions: {
    type: [String],
    default: [],
  },
  preferredLanguage: {
    type: String,
    enum: ['bn', 'en'],
    default: 'bn',
  },
  savings: {
    type: Number,
    default: 0,
  },
  profit: {
    type: Number,
    default: 0,
  },
  /** Surplus / advance funds — tracked separately from regular savings */
  advanceBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  /**
   * New-member onboarding:
   * pending (submitted) → CEO approved → cashier payment confirm → active
   */
  pendingEntryBuyIn: {
    type: Boolean,
    default: false,
    index: true,
  },
  /** Manual share / entry fee entered at registration (not auto-locked). */
  shareEntryAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  requiredEntryAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  membershipSubmittedAt: {
    type: Date,
    default: null,
  },
  ceoApprovedAt: {
    type: Date,
    default: null,
  },
  ceoApprovedBy: {
    type: String,
    trim: true,
    default: '',
  },
  membershipRejectionReason: {
    type: String,
    trim: true,
    default: '',
  },
  entryBuyInPaidAt: {
    type: Date,
    default: null,
  },
  /**
   * First calendar month the member may receive running-project / pool profits.
   * Set to the 1st of the month after activation so current-month income
   * stays with existing members; next month onwards includes the new member.
   */
  profitEligibleFrom: {
    type: Date,
    default: null,
    index: true,
  },
  /**
   * Snapshot of society baseline shown at registration (past-year deposits,
   * active project valuations, suggested share) for audit / CEO review.
   */
  registrationBaseline: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  /** Manual project valuations entered by User Management at registration */
  manualProjectValuations: {
    type: [{
      investmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment' },
      investmentCode: { type: String, trim: true, default: '' },
      label: { type: String, trim: true, default: '' },
      bookAmount: { type: Number, default: 0 },
      manualValuation: { type: Number, default: 0 },
    }],
    default: [],
  },
  /** Exit settlement metadata (when replaced or paid out from society fund) */
  exitSettledAt: {
    type: Date,
    default: null,
  },
  exitSettlementAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  exitSettledBy: {
    type: String,
    trim: true,
    default: '',
  },
  /** How the exit was funded: replacement buy-in, direct society fund, or multi-approval exit */
  exitSettlementSource: {
    type: String,
    enum: ['', 'replacement', 'society_fund', 'approved_exit'],
    default: '',
  },
  /** Historical savings migrated from pre-digital operations */
  openingSavingsBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** Historical profit migrated from pre-digital operations */
  openingProfitBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  openingBalanceSetAt: {
    type: Date,
    default: null,
  },
  openingBalanceSetBy: {
    type: String,
    trim: true,
    default: '',
  },
  /** Member this account replaced (seat transfer) — historical records of the old member stay intact */
  replacedMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  replacementEntryAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  joinedViaReplacement: {
    type: Boolean,
    default: false,
  },
  profilePicture: {
    type: String,
    trim: true,
    default: '',
  },
  dateOfBirth: {
    type: Date,
    default: null,
  },
  gender: {
    type: String,
    trim: true,
    default: '',
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  address: {
    type: String,
    trim: true,
    default: '',
  },
  nidNumber: {
    type: String,
    trim: true,
    default: '',
  },
  bankAccountName: {
    type: String,
    trim: true,
    default: '',
  },
  bankAccountNumber: {
    type: String,
    trim: true,
    default: '',
  },
  bankName: {
    type: String,
    trim: true,
    default: '',
  },
  kycStatus: {
    type: String,
    enum: ['pending', 'submitted', 'verified', 'rejected'],
    default: 'pending',
  },
  status: {
    type: String,
    // pending = submitted (awaiting CEO); approved = CEO OK, awaiting payment; active = paid & live
    enum: ['pending', 'submitted', 'approved', 'active', 'inactive', 'deleted', 'blocked'],
    default: 'active',
    index: true,
  },
  failedLoginAttempts: {
    type: Number,
    default: 0,
  },
  lockUntil: {
    type: Date,
    default: null,
    index: true,
  },
  lastFailedLoginAt: {
    type: Date,
    default: null,
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  passwordChangedAt: {
    type: Date,
    default: null,
  },
  passwordResetOtpHash: {
    type: String,
    default: null,
    select: false,
  },
  passwordResetOtpExpires: {
    type: Date,
    default: null,
  },
  passwordResetRequestedAt: {
    type: Date,
    default: null,
  },
  passwordResetVerifiedAt: {
    type: Date,
    default: null,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedReason: {
    type: String,
    trim: true,
    default: '',
  },
  deletedBy: {
    type: String,
    trim: true,
    default: '',
  },
  restoredAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

UserSchema.pre('validate', function (next) {
  if (!Array.isArray(this.permissions) || this.permissions.length === 0) {
    this.permissions = getDefaultPermissions(this.role);
  }
  next();
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.toJSON = function () {
  const object = this.toObject();
  delete object.password;
  delete object.passwordResetOtpHash;
  return object;
};

module.exports = mongoose.model('User', UserSchema);
