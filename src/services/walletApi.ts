import { fetchJson } from '../lib/apiClient';

interface MintIzeResponse {
  ok: true;
  operation: {
    id: string;
    type: 'mint';
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
    reserveGrams: number;
    reserveCoverageRatio: number | null;
  };
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
