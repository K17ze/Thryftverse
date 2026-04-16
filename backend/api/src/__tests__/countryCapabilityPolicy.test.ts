import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAllowedGatewayIds,
  isGatewayAllowedForChannel,
  isPaymentMethodTypeAllowed,
  isPayoutCurrencyAllowed,
  isPayoutGatewayAllowed,
  resolveChannelGateway,
  resolvePayoutPolicyDefaults,
} from '../lib/countryCapabilityPolicy.js';
import { resolveCountryCapabilities } from '../lib/countryCapabilities.js';

process.env.NODE_ENV ??= 'test';
process.env.STRIPE_SECRET_KEY ??= 'test-stripe-secret';
process.env.RAZORPAY_KEY_ID ??= 'test-razorpay-key-id';
process.env.RAZORPAY_KEY_SECRET ??= 'test-razorpay-key-secret';
process.env.MOLLIE_API_KEY ??= 'test-mollie-api-key';
process.env.FLUTTERWAVE_SECRET_KEY ??= 'test-flutterwave-secret-key';
process.env.TAP_SECRET_KEY ??= 'test-tap-secret-key';
process.env.WISE_API_KEY ??= 'test-wise-api-key';

test('payment method and gateway policy checks are enforced by capability cluster', () => {
  const india = resolveCountryCapabilities({ countryCode: 'IN' });
  const chinaNearby = resolveCountryCapabilities({ countryCode: 'CN' });

  assert.equal(isPaymentMethodTypeAllowed(india, 'card'), true);
  assert.equal(isPaymentMethodTypeAllowed(india, 'bank_account'), true);
  assert.equal(isPaymentMethodTypeAllowed(chinaNearby, 'bank_account'), false);

  const uk = resolveCountryCapabilities({ countryCode: 'GB' });
  assert.deepEqual(getAllowedGatewayIds(uk), ['stripe_americas', 'mollie_eu']);
  assert.deepEqual(getAllowedGatewayIds(uk, 'commerce'), ['stripe_americas', 'mollie_eu']);

  assert.equal(isGatewayAllowedForChannel(india, 'commerce', 'razorpay_in'), true);
  assert.equal(isGatewayAllowedForChannel(india, 'commerce', 'mollie_eu'), false);
});

test('channel gateway resolution honors requested override and capability defaults', () => {
  const india = resolveCountryCapabilities({ countryCode: 'IN' });

  const withOverride = resolveChannelGateway(india, 'co-own', 'mollie_eu', 'stripe_americas');
  assert.equal(withOverride, 'mollie_eu');

  const fromCapability = resolveChannelGateway(india, 'co-own', undefined, 'stripe_americas');
  assert.equal(fromCapability, 'razorpay_in');

  const noGatewayConfig = {
    ...india,
    payments: {
      ...india.payments,
      gatewaysByChannel: {
        ...india.payments.gatewaysByChannel,
        commerce: [],
      },
    },
  };

  const fallbackGateway = resolveChannelGateway(noGatewayConfig, 'commerce', null, 'stripe_americas');
  assert.equal(fallbackGateway, 'stripe_americas');
  assert.equal(isGatewayAllowedForChannel(noGatewayConfig, 'commerce', 'custom_gateway'), true);
});

test('payout defaults and support checks normalize and validate capability policy', () => {
  const us = resolveCountryCapabilities({ countryCode: 'US' });

  const normalized = resolvePayoutPolicyDefaults(us, {
    currency: 'usd',
    countryCode: 'us',
  });
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.countryCode, 'US');
  assert.equal(normalized.gatewayId, 'stripe_americas');

  const noPayoutGatewayConfig = {
    ...us,
    payouts: {
      ...us.payouts,
      gatewayPriority: [],
    },
  };

  const fallback = resolvePayoutPolicyDefaults(noPayoutGatewayConfig, {
    fallbackGatewayId: 'mollie_eu',
  });
  assert.equal(fallback.gatewayId, 'mollie_eu');

  const uk = resolveCountryCapabilities({ countryCode: 'GB' });
  assert.equal(isPayoutCurrencyAllowed(uk, 'gbp'), true);
  assert.equal(isPayoutCurrencyAllowed(uk, 'inr'), false);
  assert.equal(isPayoutGatewayAllowed(uk, 'stripe_americas'), true);
  assert.equal(isPayoutGatewayAllowed(uk, 'razorpay_in'), false);
  assert.equal(isPayoutGatewayAllowed(noPayoutGatewayConfig, 'any_gateway'), true);
});
