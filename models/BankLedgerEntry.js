const mongoose = require('mongoose');

const ENTRY_TYPES = [
  'opening',
  'deposit',
  'project_payout',
  'project_sale',
  'monthly_profit',
  'profit_distribution',
  'external_investment',
  'investor_payout',
  'loan_disbursement',
  'loan_repayment',
  'reserve_allocation',
  'reserve_disbursement',
  'operational_expense',
  'office_cost',
  'utility',
  'miscellaneous',
  'cash_out',
  'adjustment',
];

const MANUAL_EXPENSE_TYPES = Object.freeze({
  operational_expense: 'Operational Expense',
  office_cost: 'Office Cost',
  utility: 'Utility',
  cash_out: 'Direct Cash Out',
  miscellaneous: 'Miscellaneous',
});

const BankLedgerEntrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ENTRY_TYPES,
    required: true,
    index: true,
  },
  direction: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  referenceType: {
    type: String,
    trim: true,
    default: '',
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  note: {
    type: String,
    trim: true,
    default: '',
  },
  createdBy: {
    type: String,
    trim: true,
    default: '',
  },
  paymentChannel: {
    type: String,
    enum: ['cash', 'bank', 'mfs', ''],
    default: '',
    index: true,
  },
  paymentReference: {
    type: String,
    trim: true,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

BankLedgerEntrySchema.statics.ENTRY_TYPES = ENTRY_TYPES;
BankLedgerEntrySchema.statics.MANUAL_EXPENSE_TYPES = MANUAL_EXPENSE_TYPES;

module.exports = mongoose.model('BankLedgerEntry', BankLedgerEntrySchema);
