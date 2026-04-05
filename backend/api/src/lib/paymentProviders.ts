import crypto from 'node:crypto';
import Stripe from 'stripe';
import { config } from '../config.js';

export type ProviderSlug = 'stripe' | 'razorpay' | 'mollie' | 'flutterwave' | 'tap';

export type MoneyGatewayId =
  | 'mock_fiat_gbp'
  | 'mock_tvusd'
  | 'stripe_americas'
  | 'razorpay_in'
  | 'mollie_eu'
  | 'flutterwave_africa'
  | 'tap_gulf';

export type ProviderPaymentStatus =
  | 'requires_confirmation'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ProviderPayoutStatus = 'processing' | 'paid' | 'failed' | 'cancelled';
export type ProviderRefundStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type ProviderDisputeStatus = 'open' | 'warning' | 'needs_response' | 'won' | 'lost' | 'closed';

export interface NormalizedWebhookEvent {
  gatewayId: MoneyGatewayId;
  providerEventId: string;
  eventType: string;
  intentId?: string;
  providerIntentRef?: string;
  paymentStatus?: ProviderPaymentStatus;
  payoutRequestId?: string;
  payoutStatus?: ProviderPayoutStatus;
  refund?: {
    providerRefundRef: string;
    status: ProviderRefundStatus;
    amount?: number;
    currency?: string;
    reason?: string;
  };
  dispute?: {
    providerDisputeRef: string;
    status: ProviderDisputeStatus;
    amount?: number;
    currency?: string;
    reason?: string;
  };
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  verified: boolean;
  reason?: string;
  event?: NormalizedWebhookEvent;
}

function providerToGatewayId(provider: ProviderSlug): MoneyGatewayId {
  switch (provider) {
    case 'stripe':
      return 'stripe_americas';
    case 'razorpay':
      return 'razorpay_in';
    case 'mollie':
      return 'mollie_eu';
    case 'flutterwave':
      return 'flutterwave_africa';
    case 'tap':
      return 'tap_gulf';
    default:
      return 'mock_fiat_gbp';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function headerValue(headers: Record<string, unknown>, key: string): string | null {
  const lower = key.toLowerCase();
  const entries = Object.entries(headers);

  for (const [name, value] of entries) {
    if (name.toLowerCase() !== lower) {
      continue;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }
  }

  return null;
}

function hexDigest(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function derivedEventId(prefix: string, eventType: string, rawBody: string): string {
  const hash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex').slice(0, 32);
  return `${prefix}:${eventType}:${hash}`;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function statusFromStripeEvent(eventType: string): ProviderPaymentStatus | undefined {
  if (eventType === 'payment_intent.succeeded') {
    return 'succeeded';
  }

  if (eventType === 'payment_intent.processing') {
    return 'processing';
  }

  if (eventType === 'payment_intent.payment_failed') {
    return 'failed';
  }

  if (eventType === 'payment_intent.canceled') {
    return 'cancelled';
  }

  if (eventType === 'payment_intent.requires_action' || eventType === 'payment_intent.requires_confirmation') {
    return 'requires_confirmation';
  }

  return undefined;
}

function statusFromRazorpayEvent(eventType: string): ProviderPaymentStatus | undefined {
  if (eventType === 'payment.captured') {
    return 'succeeded';
  }

  if (eventType === 'payment.failed') {
    return 'failed';
  }

  if (eventType === 'payment.authorized' || eventType === 'payment.pending') {
    return 'processing';
  }

  return undefined;
}

function statusFromMollieState(status: string | undefined): ProviderPaymentStatus | undefined {
  if (!status) {
    return undefined;
  }

  if (status === 'paid') {
    return 'succeeded';
  }

  if (status === 'failed' || status === 'expired') {
    return 'failed';
  }

  if (status === 'canceled') {
    return 'cancelled';
  }

  if (status === 'open' || status === 'pending') {
    return 'processing';
  }

  return undefined;
}

function statusFromFlutterwaveState(status: string | undefined): ProviderPaymentStatus | undefined {
  if (!status) {
    return undefined;
  }

  const normalized = status.toLowerCase();

  if (normalized === 'successful' || normalized === 'success') {
    return 'succeeded';
  }

  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }

  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }

  if (normalized === 'pending') {
    return 'processing';
  }

  return undefined;
}

function statusFromTapState(status: string | undefined): ProviderPaymentStatus | undefined {
  if (!status) {
    return undefined;
  }

  const normalized = status.toLowerCase();

  if (normalized === 'captured' || normalized === 'paid') {
    return 'succeeded';
  }

  if (normalized === 'declined' || normalized === 'failed') {
    return 'failed';
  }

  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'void') {
    return 'cancelled';
  }

  if (normalized === 'initiated' || normalized === 'pending') {
    return 'processing';
  }

  return undefined;
}

function normalizeStripeEvent(event: Stripe.Event, rawBody: string): NormalizedWebhookEvent {
  const dataObject = asRecord(event.data.object);
  const metadata = asRecord(dataObject.metadata);
  const maybePaymentIntent = asString(dataObject.payment_intent) ?? asString(dataObject.id);
  const intentId =
    asString(metadata.intentId)
    ?? asString(metadata.intent_id)
    ?? asString(metadata.paymentIntentId)
    ?? undefined;

  const eventType: string = event.type;
  const providerEventId = asString(event.id) ?? derivedEventId('stripe', eventType, rawBody);

  const normalized: NormalizedWebhookEvent = {
    gatewayId: 'stripe_americas',
    providerEventId,
    eventType,
    providerIntentRef: maybePaymentIntent,
    intentId,
    paymentStatus: statusFromStripeEvent(eventType),
    metadata,
    rawPayload: asRecord(event as unknown),
  };

  if (eventType.startsWith('refund.') || eventType === 'charge.refunded') {
    const refundRef = asString(dataObject.id) ?? asString(dataObject.latest_refund) ?? providerEventId;
    normalized.refund = {
      providerRefundRef: refundRef,
      status: eventType === 'refund.failed' ? 'failed' : eventType === 'refund.canceled' ? 'cancelled' : 'succeeded',
      amount: asNumber(dataObject.amount),
      currency: asString(dataObject.currency)?.toUpperCase(),
      reason: asString(dataObject.reason),
    };
  }

  if (eventType.startsWith('charge.dispute.')) {
    const disputeStatus: ProviderDisputeStatus =
      eventType === 'charge.dispute.closed'
        ? 'closed'
        : eventType === 'charge.dispute.funds_withdrawn'
          ? 'lost'
          : eventType === 'charge.dispute.funds_reinstated'
            ? 'won'
            : 'open';

    normalized.dispute = {
      providerDisputeRef: asString(dataObject.id) ?? providerEventId,
      status: disputeStatus,
      amount: asNumber(dataObject.amount),
      currency: asString(dataObject.currency)?.toUpperCase(),
      reason: asString(dataObject.reason),
    };
  }

  return normalized;
}

function normalizeRazorpayEvent(payload: Record<string, unknown>, rawBody: string): NormalizedWebhookEvent {
  const eventType = asString(payload.event) ?? 'unknown';
  const bodyPayload = asRecord(payload.payload);
  const paymentEntity = asRecord(asRecord(bodyPayload.payment).entity);
  const refundEntity = asRecord(asRecord(bodyPayload.refund).entity);
  const payoutEntity = asRecord(asRecord(bodyPayload.payout).entity);
  const activeEntity =
    Object.keys(paymentEntity).length > 0
      ? paymentEntity
      : Object.keys(refundEntity).length > 0
        ? refundEntity
        : payoutEntity;

  const notes = asRecord(activeEntity.notes);
  const providerEntityId = asString(activeEntity.id);

  const normalized: NormalizedWebhookEvent = {
    gatewayId: 'razorpay_in',
    providerEventId: providerEntityId ? `${eventType}:${providerEntityId}` : derivedEventId('razorpay', eventType, rawBody),
    eventType,
    providerIntentRef: asString(activeEntity.order_id) ?? providerEntityId,
    intentId: asString(notes.intentId) ?? asString(notes.intent_id),
    paymentStatus: statusFromRazorpayEvent(eventType),
    metadata: notes,
    rawPayload: payload,
  };

  if (eventType.startsWith('refund.')) {
    normalized.refund = {
      providerRefundRef: providerEntityId ?? normalized.providerEventId,
      status: eventType === 'refund.failed' ? 'failed' : 'succeeded',
      amount: asNumber(activeEntity.amount),
      currency: asString(activeEntity.currency)?.toUpperCase(),
      reason: asString(activeEntity.notes),
    };
  }

  if (eventType.startsWith('dispute.')) {
    normalized.dispute = {
      providerDisputeRef: providerEntityId ?? normalized.providerEventId,
      status: eventType === 'dispute.won' ? 'won' : eventType === 'dispute.lost' ? 'lost' : 'open',
      amount: asNumber(activeEntity.amount),
      currency: asString(activeEntity.currency)?.toUpperCase(),
      reason: asString(activeEntity.reason),
    };
  }

  if (eventType.startsWith('payout.')) {
    normalized.payoutRequestId = asString(notes.payoutRequestId) ?? asString(notes.payout_request_id);
    normalized.payoutStatus =
      eventType === 'payout.processed'
        ? 'paid'
        : eventType === 'payout.failed'
          ? 'failed'
          : eventType === 'payout.reversed'
            ? 'cancelled'
            : 'processing';
  }

  return normalized;
}

async function normalizeMollieEvent(
  payload: Record<string, unknown>,
  rawBody: string
): Promise<NormalizedWebhookEvent> {
  const paymentRef = asString(payload.id);
  let eventType = asString(payload.event) ?? 'payment.updated';
  let providerStatus = asString(payload.status);
  let metadata = asRecord(payload.metadata);
  let amount: number | undefined;
  let currency: string | undefined;

  if (paymentRef && config.mollieApiKey) {
    try {
      const { createMollieClient } = await import('@mollie/api-client');
      const mollie = createMollieClient({ apiKey: config.mollieApiKey });
      const payment = await mollie.payments.get(paymentRef);
      providerStatus = asString((payment as unknown as { status?: unknown }).status) ?? providerStatus;
      metadata = asRecord((payment as unknown as { metadata?: unknown }).metadata) || metadata;
      amount = asNumber((payment as unknown as { amount?: { value?: unknown } }).amount?.value);
      currency = asString((payment as unknown as { amount?: { currency?: unknown } }).amount?.currency);
      eventType = `payment.${providerStatus ?? 'updated'}`;
    } catch {
      // Keep webhook processing resilient; status will be resolved from payload when API lookup is unavailable.
    }
  }

  return {
    gatewayId: 'mollie_eu',
    providerEventId: paymentRef ? `${eventType}:${paymentRef}` : derivedEventId('mollie', eventType, rawBody),
    eventType,
    providerIntentRef: paymentRef,
    intentId: asString(metadata.intentId) ?? asString(metadata.intent_id),
    paymentStatus: statusFromMollieState(providerStatus),
    metadata,
    rawPayload: payload,
    ...(eventType.startsWith('refund.')
      ? {
          refund: {
            providerRefundRef: paymentRef ?? derivedEventId('mollie-refund', eventType, rawBody),
            status: providerStatus === 'failed' ? 'failed' : providerStatus === 'canceled' ? 'cancelled' : 'succeeded',
            amount,
            currency: currency?.toUpperCase(),
            reason: asString(payload.reason),
          },
        }
      : {}),
  };
}

function normalizeFlutterwaveEvent(payload: Record<string, unknown>, rawBody: string): NormalizedWebhookEvent {
  const eventType = asString(payload.event) ?? 'unknown';
  const data = asRecord(payload.data);
  const metadata = asRecord(data.meta);
  const txRef = asString(data.tx_ref) ?? asString(data.flw_ref) ?? asString(data.id);

  const normalized: NormalizedWebhookEvent = {
    gatewayId: 'flutterwave_africa',
    providerEventId: txRef ? `${eventType}:${txRef}` : derivedEventId('flutterwave', eventType, rawBody),
    eventType,
    providerIntentRef: txRef,
    intentId: asString(metadata.intentId) ?? asString(metadata.intent_id),
    paymentStatus: statusFromFlutterwaveState(asString(data.status)),
    metadata,
    rawPayload: payload,
  };

  if (eventType.toLowerCase().includes('refund')) {
    normalized.refund = {
      providerRefundRef: asString(data.id) ?? normalized.providerEventId,
      status: asString(data.status)?.toLowerCase() === 'failed' ? 'failed' : 'succeeded',
      amount: asNumber(data.amount),
      currency: asString(data.currency)?.toUpperCase(),
      reason: asString(data.reason),
    };
  }

  if (eventType.toLowerCase().includes('dispute')) {
    normalized.dispute = {
      providerDisputeRef: asString(data.id) ?? normalized.providerEventId,
      status: asString(data.status)?.toLowerCase() === 'lost' ? 'lost' : 'open',
      amount: asNumber(data.amount),
      currency: asString(data.currency)?.toUpperCase(),
      reason: asString(data.reason),
    };
  }

  return normalized;
}

function normalizeTapEvent(payload: Record<string, unknown>, rawBody: string): NormalizedWebhookEvent {
  const eventType = asString(payload.event_type) ?? asString(payload.status) ?? 'unknown';
  const data = asRecord(payload.data);
  const metadata = asRecord(payload.metadata);
  const providerIntentRef =
    asString(payload.id)
    ?? asString(asRecord(payload.reference).payment)
    ?? asString(data.id)
    ?? undefined;

  const normalized: NormalizedWebhookEvent = {
    gatewayId: 'tap_gulf',
    providerEventId: providerIntentRef
      ? `${eventType}:${providerIntentRef}`
      : derivedEventId('tap', eventType, rawBody),
    eventType,
    providerIntentRef,
    intentId: asString(metadata.intentId) ?? asString(metadata.intent_id),
    paymentStatus: statusFromTapState(asString(payload.status)),
    metadata,
    rawPayload: payload,
  };

  if (eventType.toLowerCase().includes('refund')) {
    normalized.refund = {
      providerRefundRef: providerIntentRef ?? normalized.providerEventId,
      status: asString(payload.status)?.toLowerCase() === 'failed' ? 'failed' : 'succeeded',
      amount: asNumber(asRecord(payload.amount).value),
      currency: asString(asRecord(payload.amount).currency)?.toUpperCase(),
      reason: asString(payload.description),
    };
  }

  if (eventType.toLowerCase().includes('dispute')) {
    normalized.dispute = {
      providerDisputeRef: providerIntentRef ?? normalized.providerEventId,
      status: asString(payload.status)?.toLowerCase() === 'closed' ? 'closed' : 'open',
      amount: asNumber(asRecord(payload.amount).value),
      currency: asString(asRecord(payload.amount).currency)?.toUpperCase(),
      reason: asString(payload.description),
    };
  }

  return normalized;
}

function verifyHmacSignature(
  headers: Record<string, unknown>,
  headerName: string,
  secret: string | undefined,
  rawBody: string,
  stripPrefix = false
): boolean {
  if (!secret) {
    return false;
  }

  const provided = headerValue(headers, headerName);
  if (!provided) {
    return false;
  }

  const normalized = stripPrefix ? provided.replace(/^sha256=/i, '') : provided;
  const expected = hexDigest(secret, rawBody);
  return timingSafeEqualHex(expected, normalized);
}

function verifyStripeSignature(headers: Record<string, unknown>, rawBody: string): Stripe.Event | null {
  if (!config.stripeWebhookSecret) {
    return null;
  }

  const signature = headerValue(headers, 'stripe-signature');
  if (!signature) {
    return null;
  }

  const stripe = new Stripe(config.stripeSecretKey ?? 'sk_test_placeholder', {
    apiVersion: '2024-06-20',
  });

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch {
    return null;
  }
}

export async function verifyAndNormalizeWebhook(
  provider: ProviderSlug,
  rawBody: string,
  headers: Record<string, unknown>,
  parsedBody: unknown
): Promise<WebhookVerificationResult> {
  const payload = asRecord(parsedBody);

  if (provider === 'stripe') {
    const stripeEvent = verifyStripeSignature(headers, rawBody);
    if (!stripeEvent) {
      return {
        verified: false,
        reason: 'Invalid Stripe webhook signature',
      };
    }

    return {
      verified: true,
      event: normalizeStripeEvent(stripeEvent, rawBody),
    };
  }

  if (provider === 'razorpay') {
    const ok = verifyHmacSignature(
      headers,
      'x-razorpay-signature',
      config.razorpayWebhookSecret ?? config.razorpayKeySecret,
      rawBody
    );

    if (!ok) {
      return {
        verified: false,
        reason: 'Invalid Razorpay webhook signature',
      };
    }

    return {
      verified: true,
      event: normalizeRazorpayEvent(payload, rawBody),
    };
  }

  if (provider === 'mollie') {
    if (config.mollieWebhookSecret) {
      const ok = verifyHmacSignature(headers, 'x-mollie-signature', config.mollieWebhookSecret, rawBody);
      if (!ok) {
        return {
          verified: false,
          reason: 'Invalid Mollie webhook signature',
        };
      }
    }

    return {
      verified: true,
      event: await normalizeMollieEvent(payload, rawBody),
    };
  }

  if (provider === 'flutterwave') {
    const provided = headerValue(headers, 'verif-hash');
    const expected = config.flutterwaveWebhookSecret ?? config.flutterwaveSecretKey;

    if (!provided || !expected || provided !== expected) {
      return {
        verified: false,
        reason: 'Invalid Flutterwave webhook signature',
      };
    }

    return {
      verified: true,
      event: normalizeFlutterwaveEvent(payload, rawBody),
    };
  }

  if (provider === 'tap') {
    const signature =
      headerValue(headers, 'x-tap-signature')
      ?? headerValue(headers, 'tap-signature')
      ?? headerValue(headers, 'x-signature');

    if (!signature || !(config.tapWebhookSecret ?? config.tapSecretKey)) {
      return {
        verified: false,
        reason: 'Missing Tap webhook signature configuration',
      };
    }

    const expected = hexDigest(config.tapWebhookSecret ?? config.tapSecretKey ?? '', rawBody);
    const normalized = signature.replace(/^sha256=/i, '');

    if (!timingSafeEqualHex(expected, normalized)) {
      return {
        verified: false,
        reason: 'Invalid Tap webhook signature',
      };
    }

    return {
      verified: true,
      event: normalizeTapEvent(payload, rawBody),
    };
  }

  return {
    verified: false,
    reason: `Unsupported provider '${provider}'`,
  };
}

export function resolveProviderFromPathSegment(providerSegment: string): ProviderSlug | null {
  const normalized = providerSegment.trim().toLowerCase();
  if (normalized === 'stripe') {
    return 'stripe';
  }

  if (normalized === 'razorpay') {
    return 'razorpay';
  }

  if (normalized === 'mollie') {
    return 'mollie';
  }

  if (normalized === 'flutterwave') {
    return 'flutterwave';
  }

  if (normalized === 'tap') {
    return 'tap';
  }

  return null;
}

export function expectedGatewayIdForProvider(provider: ProviderSlug): MoneyGatewayId {
  return providerToGatewayId(provider);
}
