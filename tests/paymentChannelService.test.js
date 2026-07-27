const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePaymentChannel,
  paymentChannelLabel,
} = require('../services/paymentChannelService');

describe('paymentChannelService', () => {
  it('normalizes aliases to supported channels', () => {
    assert.equal(normalizePaymentChannel('bank_transfer'), 'bank');
    assert.equal(normalizePaymentChannel('mobile_banking'), 'mfs');
    assert.equal(normalizePaymentChannel('cash'), 'cash');
  });

  it('returns readable labels', () => {
    assert.equal(paymentChannelLabel('mfs'), 'Mobile Financial Services');
  });
});
