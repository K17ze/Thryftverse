import { fetchJson } from '../lib/apiClient';

export type PaymentIntentChannel =
  | 'commerce'
  | 'co-own'
  | 'wallet_topup'
  | 'wallet_withdrawal';

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface PaymentIntentPayload {
  id: string;
  userId: string;
  gatewayId: string;
  channel: PaymentIntentChannel;
  orderId: string | null;
  coOwnOrderId: number | null;
  instrumentId: number | null;
  amountGbp: number;
  amountCurrency: string;
  status: PaymentIntentStatus;
  providerIntentRef: string | null;
  clientSecret: string | null;
  providerStatus: string | null;
  nextActionUrl: string | null;
  scaExpiresAt: string | null;
  settledAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutAccountPayload {
  id: number;
  userId: string;
  gatewayId: string;
  providerAccountRef: string;
  countryCode: string | null;
  currency: string;
  status: 'pending' | 'active' | 'disabled';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutRequestPayload {
  id: string;
  userId: string;
  payoutAccountId: number;
  amountGbp: number;
  amountCurrency: string;
  status: 'requested' | 'processing' | 'paid' | 'failed' | 'cancelled';
  providerPayoutRef: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IzeQuotePayload {
  direction: 'mint' | 'burn';
  fiatCurrency: string;
  fiatAmount: number;
  netFiatAmount?: number;
  izeAmount: number;
  platformFeeRate?: number;
  platformFeeAmount?: number;
  ratePerGram: number;
  rateSource: string;
}

export interface IzeFxQuotePayload {
  fromCurrency: string;
  toCurrency: string;
  inputAmount: number;
  fxRate: number;
  convertedAmount: number;
  source: 'identity' | 'xau_cross';
  referenceRates?: {
    from: {
      currency: string;
      ratePerGram: number;
      source: string;
      fetchedAt: string;
      expiresAt: string;
      isFallback: boolean;
      isOverride: boolean;
    };
    to: {
      currency: string;
      ratePerGram: number;
      source: string;
      fetchedAt: string;
      expiresAt: string;
      isFallback: boolean;
      isOverride: boolean;
    };
  };
}

interface IzeQuoteResponse {
  ok: true;
  quote: IzeQuotePayload;
}

interface IzeFxQuoteResponse {
  ok: true;
  quote: IzeFxQuotePayload;
}

interface CreatePaymentIntentResponse {
  ok: true;
  idempotent: boolean;
  intent: PaymentIntentPayload;
}

interface ConfirmPaymentIntentResponse {
  ok: true;
  alreadyFinal: boolean;
  idempotent?: boolean;
  intent: PaymentIntentPayload;
}

interface ListPayoutAccountsResponse {
  ok: true;
  items: PayoutAccountPayload[];
}

interface CreatePayoutAccountResponse {
  ok: true;
  item: PayoutAccountPayload;
}

interface CreatePayoutRequestResponse {
  ok: true;
  payoutRequest: PayoutRequestPayload;
  balance?: {
    sellerPayableBeforeRequestGbp: number;
    sellerPayableAfterRequestGbp: number;
  };
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    search.set(key, String(value));
  });

  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

interface MintIzeResponse {
  ok: true;
  operation: {
    id: string;
    type: 'mint';
    userId: string;
    fiatAmount: number;
    grossFiatAmount?: number;
    netFiatAmount?: number;
    platformFeeRate?: number;
    platformFeeAmount?: number;
    fiatCurrency: string;
    izeAmount: number;
    ratePerGram: number;
    rateSource: string;
  };
  balances: {
    userIze: number;
    outstandingIze: number;
    circulatingIze?: number;
    supplyDeltaIze?: number;
    supplyParityRatio?: number | null;
    liquidityBufferGrams?: number;
    reserveGrams: number;
  };
}

interface BurnIzeResponse {
  ok: true;
  operation: {
    id: string;
    type: 'burn';
    userId: string;
    fiatAmount: number;
    fiatCurrency: string;
    izeAmount: number;
    ratePerGram: number;
    rateSource: string;
  };
  balances: {
    userIze: number;
    outstandingIze: number;
    circulatingIze?: number;
    supplyDeltaIze?: number;
    supplyParityRatio?: number | null;
    liquidityBufferGrams?: number;
    reserveGrams: number;
  };
}

interface WalletIzePositionResponse {
  ok: true;
  userId: string;
  rate: {
    currency: string;
    ratePerGram: number;
    source: string;
    fetchedAt: string;
    expiresAt: string;
    isFallback: boolean;
    isOverride: boolean;
  };
  balances: {
    userIze: number;
    userFiatValue: number;
    outstandingIze: number;
    circulatingIze?: number;
    supplyDeltaIze?: number;
    supplyParityRatio?: number | null;
    liquidityBufferGrams?: number;
    reserveGrams: number;
    reserveCoverageRatio: number | null;
  };
}

export async function getIzeQuote(input: {
  fiatCurrency?: string;
  fiatAmount?: number;
  izeAmount?: number;
  forceRefresh?: boolean;
}) {
  const providedCount = Number(input.fiatAmount !== undefined) + Number(input.izeAmount !== undefined);
  if (providedCount !== 1) {
    throw new Error('Provide exactly one of fiatAmount or izeAmount for getIzeQuote');
  }

  const query = buildQuery({
    fiatCurrency: input.fiatCurrency ?? 'GBP',
    fiatAmount: input.fiatAmount,
    izeAmount: input.izeAmount,
    forceRefresh: input.forceRefresh,
  });

  return fetchJson<IzeQuoteResponse>(`/wallet/1ze/quote${query}`);
}

export async function getIzeFxQuote(input: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  forceRefresh?: boolean;
}) {
  const query = buildQuery({
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    amount: input.amount,
    forceRefresh: input.forceRefresh,
  });

  return fetchJson<IzeFxQuoteResponse>(`/wallet/1ze/fx-quote${query}`);
}

export async function createPaymentIntent(input: {
  userId?: string;
  gatewayId?: string;
  instrumentId?: number;
  channel: Extract<PaymentIntentChannel, 'wallet_topup' | 'wallet_withdrawal'>;
  amountGbp: number;
  amountCurrency?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  return fetchJson<CreatePaymentIntentResponse>('/payments/intents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId,
      gatewayId: input.gatewayId,
      instrumentId: input.instrumentId,
      channel: input.channel,
      amountGbp: input.amountGbp,
      amountCurrency: input.amountCurrency ?? 'GBP',
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    }),
  });
}

export async function confirmPaymentIntent(
  intentId: string,
  input: {
    simulateStatus?: 'processing' | 'succeeded' | 'failed' | 'cancelled';
    providerFeeGbp?: number;
    providerAttemptRef?: string;
    providerStatus?: string;
    nextActionUrl?: string;
    scaExpiresAt?: string;
    failureCode?: string;
    failureMessage?: string;
    payload?: Record<string, unknown>;
  } = {}
) {
  return fetchJson<ConfirmPaymentIntentResponse>(
    `/payments/intents/${encodeURIComponent(intentId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulateStatus: input.simulateStatus ?? 'succeeded',
        providerFeeGbp: input.providerFeeGbp,
        providerAttemptRef: input.providerAttemptRef,
        providerStatus: input.providerStatus,
        nextActionUrl: input.nextActionUrl,
        scaExpiresAt: input.scaExpiresAt,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        payload: input.payload,
      }),
    }
  );
}

export async function listPayoutAccounts(userId: string) {
  const payload = await fetchJson<ListPayoutAccountsResponse>(
    `/users/${encodeURIComponent(userId)}/payout-accounts`
  );

  return payload.items;
}

export async function createPayoutAccount(
  userId: string,
  input: {
    gatewayId?: string;
    providerAccountRef?: string;
    countryCode?: string;
    currency?: string;
    status?: 'pending' | 'active' | 'disabled';
    metadata?: Record<string, unknown>;
  }
) {
  const payload = await fetchJson<CreatePayoutAccountResponse>(
    `/users/${encodeURIComponent(userId)}/payout-accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  return payload.item;
}

export async function createPayoutRequest(
  userId: string,
  input: {
    payoutAccountId: number;
    amountGbp?: number;
    amount?: number;
    amountCurrency?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return fetchJson<CreatePayoutRequestResponse>(
    `/users/${encodeURIComponent(userId)}/payout-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payoutAccountId: input.payoutAccountId,
        amountGbp: input.amountGbp,
        amount: input.amount,
        amountCurrency: input.amountCurrency ?? 'GBP',
        metadata: input.metadata,
      }),
    }
  );
}

export async function mintIze(input: {
  userId: string;
  fiatAmount: number;
  fiatCurrency?: string;
  paymentIntentId?: string;
  metadata?: Record<string, unknown>;
}) {
  return fetchJson<MintIzeResponse>('/wallet/1ze/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function burnIze(input: {
  userId: string;
  izeAmount: number;
  fiatCurrency?: string;
  payoutRequestId?: string;
  metadata?: Record<string, unknown>;
}) {
  return fetchJson<BurnIzeResponse>('/wallet/1ze/burn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function getIzePosition(userId: string, fiatCurrency = 'GBP') {
  return fetchJson<WalletIzePositionResponse>(
    `/wallet/1ze/${encodeURIComponent(userId)}/position?fiatCurrency=${encodeURIComponent(fiatCurrency)}`
  );
}
