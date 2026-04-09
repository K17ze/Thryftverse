import { fetchJson } from '../lib/apiClient';

export type CapabilityCountryCluster =
  | 'IN'
  | 'US'
  | 'UK'
  | 'EUROPE'
  | 'MIDDLE_EAST'
  | 'CHINA_NEARBY'
  | 'GLOBAL';

export type CapabilityPaymentGatewayId =
  | 'stripe_americas'
  | 'razorpay_in'
  | 'mollie_eu'
  | 'flutterwave_africa'
  | 'tap_gulf'
  | 'mock_fiat_gbp';

export type CapabilityPaymentChannel = 'commerce' | 'co-own' | 'wallet_topup' | 'wallet_withdrawal';
export type CapabilityPaymentMethodType = 'card' | 'bank_account' | 'wallet';

export interface CapabilityCarrier {
  id: string;
  label: string;
  priceFromGbp: number;
  etaMinDays: number;
  etaMaxDays: number;
  tracking: boolean;
}

export interface UserCountryCapabilities {
  policyVersion: string;
  generatedAt: string;
  countryCode: string;
  residencyCountryCode: string | null;
  effectiveCountryCode: string;
  countryCluster: CapabilityCountryCluster;
  jurisdictionGroups: string[];
  currency: {
    defaultCurrency: string;
    supportedCurrencies: string[];
  };
  payments: {
    stableCoinEnabled: boolean;
    methodTypes: CapabilityPaymentMethodType[];
    gatewaysByChannel: Record<CapabilityPaymentChannel, CapabilityPaymentGatewayId[]>;
  };
  payouts: {
    defaultCurrency: string;
    supportedCurrencies: string[];
    gatewayPriority: CapabilityPaymentGatewayId[];
  };
  postage: {
    carriers: CapabilityCarrier[];
  };
}

interface UserCapabilitiesResponse {
  ok: true;
  userId: string;
  profile: {
    countryCode: string;
    residencyCountryCode: string | null;
    kycStatus: string;
  };
  capabilities: UserCountryCapabilities;
}

export async function getUserCountryCapabilities(userId: string): Promise<UserCountryCapabilities> {
  const payload = await fetchJson<UserCapabilitiesResponse>(
    `/users/${encodeURIComponent(userId)}/capabilities`
  );

  return payload.capabilities;
}
