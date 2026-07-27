const PAYMENT_CHANNELS = Object.freeze([
  { key: 'cash', label: 'Cash', ledgerKey: 'cash' },
  { key: 'bank', label: 'Bank Transfer', ledgerKey: 'bank' },
  { key: 'mfs', label: 'Mobile Financial Services', ledgerKey: 'mfs' },
]);

const PAYMENT_CHANNEL_KEYS = PAYMENT_CHANNELS.map((item) => item.key);

const CHANNEL_LABELS = Object.freeze(
  PAYMENT_CHANNELS.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
  }, {})
);

function normalizePaymentChannel(value, fallback = 'cash') {
  const key = String(value || fallback).trim().toLowerCase();
  if (PAYMENT_CHANNEL_KEYS.includes(key)) return key;
  if (key === 'bank_transfer' || key === 'bank') return 'bank';
  if (key === 'mobile_banking' || key === 'mobile' || key === 'mfs') return 'mfs';
  return PAYMENT_CHANNEL_KEYS.includes(fallback) ? fallback : 'cash';
}

function paymentChannelLabel(channel) {
  return CHANNEL_LABELS[normalizePaymentChannel(channel)] || 'Cash';
}

module.exports = {
  PAYMENT_CHANNELS,
  PAYMENT_CHANNEL_KEYS,
  CHANNEL_LABELS,
  normalizePaymentChannel,
  paymentChannelLabel,
};
