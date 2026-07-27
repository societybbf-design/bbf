const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  /**
   * regular — monthly / normal digital deposit (toward that month's fixed target)
   * opening_balance — historical savings migrated from pre-digital period
   * replacement_entry — buy-in paid by a member replacing a departing member
   * advance — surplus funds credited to member advanceBalance (not savings)
   * borrow_repayment — repayment of an internal borrowing (settles to lender advance)
   * member_buyin — new member share valuation deposit (activates account)
   * exit_settlement — payout/settlement to a departing member funded by replacement payment
   */
  type: {
    type: String,
    enum: [
      'regular',
      'opening_balance',
      'replacement_entry',
      'advance',
      'borrow_repayment',
      'member_buyin',
      'exit_settlement',
    ],
    default: 'regular',
    index: true,
  },
  /** Calendar month this deposit applies to (YYYY-MM), used for fixed-target tracking */
  yearMonth: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  /** Portion of this deposit applied toward the month's fixed target (savings) */
  towardTarget: {
    type: Number,
    default: null,
  },
  /** Portion routed to advanceBalance as surplus above the month's target */
  surplusToAdvance: {
    type: Number,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  recordedBy: {
    type: String,
    trim: true,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Deposit', DepositSchema);
