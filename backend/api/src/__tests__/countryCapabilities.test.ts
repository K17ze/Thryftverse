import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCountryCapabilities } from '../lib/countryCapabilities.js';

process.env.NODE_ENV ??= 'test';
process.env.STRIPE_SECRET_KEY ??= 'test-stripe-secret';
process.env.RAZORPAY_KEY_ID ??= 'test-razorpay-key-id';
process.env.RAZORPAY_KEY_SECRET ??= 'test-razorpay-key-secret';
process.env.MOLLIE_API_KEY ??= 'test-mollie-api-key';
process.env.FLUTTERWAVE_SECRET_KEY ??= 'test-flutterwave-secret-key';
process.env.TAP_SECRET_KEY ??= 'test-tap-secret-key';
process.env.WISE_API_KEY ??= 'test-wise-api-key';

test('resolveCountryCapabilities maps target countries to expected clusters and defaults', () => {
  const testCases = [
    {
      countryCode: 'IN',
      expectedCluster: 'IN',
      expectedCurrency: 'INR',
      expectedPrimaryGateway: 'razorpay_in',
    },
    {
      countryCode: 'US',
      expectedCluster: 'US',
      expectedCurrency: 'USD',
      expectedPrimaryGateway: 'stripe_americas',
    },
    {
      countryCode: 'GB',
      expectedCluster: 'UK',
      expectedCurrency: 'GBP',
      expectedPrimaryGateway: 'stripe_americas',
    },
    {
      countryCode: 'FR',
      expectedCluster: 'EUROPE',
      expectedCurrency: 'EUR',
      expectedPrimaryGateway: 'mollie_eu',
    },
    {
      countryCode: 'AE',
      expectedCluster: 'MIDDLE_EAST',
      expectedCurrency: 'AED',
      expectedPrimaryGateway: 'tap_gulf',
    },
    {
      countryCode: 'CN',
      expectedCluster: 'CHINA_NEARBY',
      expectedCurrency: 'USD',
      expectedPrimaryGateway: 'stripe_americas',
    },
  ] as const;

  for (const testCase of testCases) {
    const capabilities = resolveCountryCapabilities({ countryCode: testCase.countryCode });

    assert.equal(capabilities.countryCluster, testCase.expectedCluster, `cluster mismatch for ${testCase.countryCode}`);
    assert.equal(capabilities.currency.defaultCurrency, testCase.expectedCurrency, `default currency mismatch for ${testCase.countryCode}`);
    assert.ok(
      capabilities.payments.gatewaysByChannel.commerce.includes(testCase.expectedPrimaryGateway),
      `commerce gateways missing ${testCase.expectedPrimaryGateway} for ${testCase.countryCode}`
    );
    assert.ok(capabilities.postage.carriers.length > 0, `no postage carriers for ${testCase.countryCode}`);
    assert.ok(capabilities.jurisdictionGroups.includes('GLOBAL'), `missing GLOBAL jurisdiction for ${testCase.countryCode}`);
  }
});

test('resolveCountryCapabilities prefers residency country when present', () => {
  const capabilities = resolveCountryCapabilities({
    countryCode: 'US',
    residencyCountryCode: 'IN',
  });

  assert.equal(capabilities.effectiveCountryCode, 'IN');
  assert.equal(capabilities.countryCluster, 'IN');
  assert.equal(capabilities.currency.defaultCurrency, 'INR');
  assert.ok(capabilities.jurisdictionGroups.includes('IN'));
});

test('resolveCountryCapabilities falls back to GLOBAL template for non-target countries', () => {
  const capabilities = resolveCountryCapabilities({ countryCode: 'BR' });

  assert.equal(capabilities.countryCluster, 'GLOBAL');
  assert.equal(capabilities.currency.defaultCurrency, 'USD');
  assert.deepEqual(capabilities.postage.carriers, []);
  assert.deepEqual(capabilities.payments.gatewaysByChannel.commerce, ['stripe_americas']);
  assert.deepEqual(capabilities.payouts.gatewayPriority, ['stripe_americas', 'mollie_eu', 'wise_global']);
});

test('resolveCountryCapabilities applies channel and payment policy nuances by cluster', () => {
  const middleEast = resolveCountryCapabilities({ countryCode: 'AE' });
  assert.ok(middleEast.payments.gatewaysByChannel.wallet_withdrawal.includes('tap_gulf'));
  assert.ok(middleEast.payments.methodTypes.includes('bank_account'));

  const chinaNearby = resolveCountryCapabilities({ countryCode: 'CN' });
  assert.equal(chinaNearby.payments.stableCoinEnabled, false);
  assert.equal(chinaNearby.payments.methodTypes.includes('bank_account'), false);
  assert.deepEqual(chinaNearby.payments.gatewaysByChannel['co-own'], ['stripe_americas']);
});

test('resolveCountryCapabilities normalizes invalid country input via compliance fallback', () => {
  const capabilities = resolveCountryCapabilities({ countryCode: '   ' });

  assert.equal(capabilities.countryCode, 'GB');
  assert.equal(capabilities.effectiveCountryCode, 'GB');
  assert.equal(capabilities.countryCluster, 'UK');
});
