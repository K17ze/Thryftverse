import { countryToJurisdictionGroups, normalizeCountryCode } from './compliance.js';

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
  | 'wise_global'
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

interface CapabilityTemplate {
  defaultCurrency: string;
  supportedCurrencies: string[];
  stableCoinEnabled: boolean;
  paymentMethodTypes: CapabilityPaymentMethodType[];
  gatewaysByChannel: Record<CapabilityPaymentChannel, CapabilityPaymentGatewayId[]>;
  payoutDefaultCurrency: string;
  payoutSupportedCurrencies: string[];
  payoutGatewayPriority: CapabilityPaymentGatewayId[];
  postageCarriers: CapabilityCarrier[];
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

export interface ResolveCountryCapabilitiesInput {
  countryCode: string;
  residencyCountryCode?: string | null;
}

const POLICY_VERSION = '2026-04-country-capabilities-v1';

const EUROPE_COUNTRIES = new Set<string>([
  'AL', 'AD', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO',
  'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME',
  'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA', 'XK',
]);

const MIDDLE_EAST_COUNTRIES = new Set<string>([
  'AE', 'BH', 'EG', 'IL', 'IQ', 'IR', 'JO', 'KW', 'LB', 'OM', 'PS', 'QA', 'SA', 'SY', 'TR', 'YE',
]);

const CHINA_NEARBY_COUNTRIES = new Set<string>([
  'CN', 'HK', 'ID', 'JP', 'KR', 'MN', 'MO', 'MY', 'PH', 'SG', 'TH', 'TW', 'VN',
]);

const TARGET_CLUSTER_COUNTRIES = {
  IN: new Set<string>(['IN']),
  US: new Set<string>(['US']),
  UK: new Set<string>(['GB']),
};

const CAPABILITY_TEMPLATES: Record<CapabilityCountryCluster, CapabilityTemplate> = {
  IN: {
    defaultCurrency: 'INR',
    supportedCurrencies: ['INR', 'USD', 'GBP', 'EUR'],
    stableCoinEnabled: true,
    paymentMethodTypes: ['card', 'bank_account', 'wallet'],
    gatewaysByChannel: {
      commerce: ['razorpay_in', 'stripe_americas'],
      'co-own': ['razorpay_in', 'stripe_americas'],
      wallet_topup: ['razorpay_in', 'stripe_americas'],
      wallet_withdrawal: ['razorpay_in'],
    },
    payoutDefaultCurrency: 'INR',
    payoutSupportedCurrencies: ['INR', 'USD'],
    payoutGatewayPriority: ['razorpay_in', 'stripe_americas', 'wise_global'],
    postageCarriers: [
      { id: 'delhivery', label: 'Delhivery', priceFromGbp: 1.75, etaMinDays: 2, etaMaxDays: 4, tracking: true },
      { id: 'bluedart', label: 'Blue Dart', priceFromGbp: 2.2, etaMinDays: 1, etaMaxDays: 3, tracking: true },
      { id: 'india_post', label: 'India Post', priceFromGbp: 1.35, etaMinDays: 3, etaMaxDays: 6, tracking: true },
    ],
  },
  US: {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'GBP', 'EUR'],
    stableCoinEnabled: true,
    paymentMethodTypes: ['card', 'bank_account', 'wallet'],
    gatewaysByChannel: {
      commerce: ['stripe_americas'],
      'co-own': ['stripe_americas'],
      wallet_topup: ['stripe_americas'],
      wallet_withdrawal: ['stripe_americas'],
    },
    payoutDefaultCurrency: 'USD',
    payoutSupportedCurrencies: ['USD'],
    payoutGatewayPriority: ['stripe_americas', 'wise_global'],
    postageCarriers: [
      { id: 'usps', label: 'USPS', priceFromGbp: 2.15, etaMinDays: 2, etaMaxDays: 5, tracking: true },
      { id: 'ups', label: 'UPS', priceFromGbp: 3.1, etaMinDays: 1, etaMaxDays: 3, tracking: true },
      { id: 'fedex', label: 'FedEx', priceFromGbp: 3.35, etaMinDays: 1, etaMaxDays: 2, tracking: true },
    ],
  },
  UK: {
    defaultCurrency: 'GBP',
    supportedCurrencies: ['GBP', 'EUR', 'USD'],
    stableCoinEnabled: true,
    paymentMethodTypes: ['card', 'bank_account', 'wallet'],
    gatewaysByChannel: {
      commerce: ['stripe_americas', 'mollie_eu'],
      'co-own': ['stripe_americas', 'mollie_eu'],
      wallet_topup: ['stripe_americas', 'mollie_eu'],
      wallet_withdrawal: ['stripe_americas', 'mollie_eu'],
    },
    payoutDefaultCurrency: 'GBP',
    payoutSupportedCurrencies: ['GBP', 'EUR', 'USD'],
    payoutGatewayPriority: ['stripe_americas', 'mollie_eu', 'wise_global'],
    postageCarriers: [
      { id: 'evri', label: 'Evri', priceFromGbp: 2.89, etaMinDays: 2, etaMaxDays: 3, tracking: true },
      { id: 'royal_mail', label: 'Royal Mail', priceFromGbp: 3.35, etaMinDays: 1, etaMaxDays: 3, tracking: true },
      { id: 'dpd', label: 'DPD', priceFromGbp: 4.5, etaMinDays: 1, etaMaxDays: 2, tracking: true },
    ],
  },
  EUROPE: {
    defaultCurrency: 'EUR',
    supportedCurrencies: ['EUR', 'GBP', 'USD'],
    stableCoinEnabled: true,
    paymentMethodTypes: ['card', 'bank_account', 'wallet'],
    gatewaysByChannel: {
      commerce: ['mollie_eu', 'stripe_americas'],
      'co-own': ['mollie_eu', 'stripe_americas'],
      wallet_topup: ['mollie_eu', 'stripe_americas'],
      wallet_withdrawal: ['mollie_eu', 'stripe_americas'],
    },
    payoutDefaultCurrency: 'EUR',
    payoutSupportedCurrencies: ['EUR', 'GBP', 'USD'],
    payoutGatewayPriority: ['mollie_eu', 'stripe_americas', 'wise_global'],
    postageCarriers: [
      { id: 'dhl_eu', label: 'DHL Parcel', priceFromGbp: 3.1, etaMinDays: 2, etaMaxDays: 5, tracking: true },
      { id: 'gls', label: 'GLS', priceFromGbp: 2.95, etaMinDays: 2, etaMaxDays: 4, tracking: true },
      { id: 'dpd_eu', label: 'DPD EU', priceFromGbp: 3.35, etaMinDays: 1, etaMaxDays: 3, tracking: true },
    ],
  },
  MIDDLE_EAST: {
    defaultCurrency: 'AED',
    supportedCurrencies: ['AED', 'USD', 'EUR'],
    stableCoinEnabled: true,
    paymentMethodTypes: ['card', 'bank_account', 'wallet'],
    gatewaysByChannel: {
      commerce: ['tap_gulf', 'stripe_americas'],
      'co-own': ['tap_gulf', 'stripe_americas'],
      wallet_topup: ['tap_gulf', 'stripe_americas'],
      wallet_withdrawal: ['tap_gulf', 'stripe_americas'],
    },
    payoutDefaultCurrency: 'AED',
    payoutSupportedCurrencies: ['AED', 'USD'],
    payoutGatewayPriority: ['tap_gulf', 'stripe_americas', 'wise_global'],
    postageCarriers: [
      { id: 'aramex', label: 'Aramex', priceFromGbp: 2.75, etaMinDays: 1, etaMaxDays: 3, tracking: true },
      { id: 'dhl_express_me', label: 'DHL Express', priceFromGbp: 3.6, etaMinDays: 1, etaMaxDays: 2, tracking: true },
      { id: 'fetchr', label: 'Fetchr', priceFromGbp: 2.3, etaMinDays: 2, etaMaxDays: 4, tracking: true },
    ],
  },
  CHINA_NEARBY: {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'EUR', 'GBP'],
    stableCoinEnabled: false,
    paymentMethodTypes: ['card', 'wallet'],
    gatewaysByChannel: {
      commerce: ['stripe_americas'],
      'co-own': ['stripe_americas'],
      wallet_topup: ['stripe_americas'],
      wallet_withdrawal: ['stripe_americas'],
    },
    payoutDefaultCurrency: 'USD',
    payoutSupportedCurrencies: ['USD'],
    payoutGatewayPriority: ['stripe_americas', 'wise_global'],
    postageCarriers: [
      { id: 'sf_express', label: 'SF Express', priceFromGbp: 2.45, etaMinDays: 1, etaMaxDays: 3, tracking: true },
      { id: 'cainiao', label: 'Cainiao', priceFromGbp: 1.95, etaMinDays: 2, etaMaxDays: 5, tracking: true },
      { id: 'dhl_asia', label: 'DHL eCommerce Asia', priceFromGbp: 3.2, etaMinDays: 2, etaMaxDays: 4, tracking: true },
    ],
  },
  GLOBAL: {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'GBP', 'EUR'],
    stableCoinEnabled: false,
    paymentMethodTypes: ['card'],
    gatewaysByChannel: {
      commerce: ['stripe_americas'],
      'co-own': ['stripe_americas'],
      wallet_topup: ['stripe_americas'],
      wallet_withdrawal: ['stripe_americas'],
    },
    payoutDefaultCurrency: 'USD',
    payoutSupportedCurrencies: ['USD', 'GBP', 'EUR'],
    payoutGatewayPriority: ['stripe_americas', 'mollie_eu', 'wise_global'],
    postageCarriers: [
      { id: 'dhl_global', label: 'DHL Global', priceFromGbp: 3.75, etaMinDays: 3, etaMaxDays: 6, tracking: true },
      { id: 'standard_intl', label: 'Standard International', priceFromGbp: 2.55, etaMinDays: 4, etaMaxDays: 8, tracking: true },
    ],
  },
};

function dedupeUpper(items: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const item of items) {
    const normalized = item.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

function cloneTemplate(template: CapabilityTemplate): CapabilityTemplate {
  return {
    defaultCurrency: template.defaultCurrency,
    supportedCurrencies: [...template.supportedCurrencies],
    stableCoinEnabled: template.stableCoinEnabled,
    paymentMethodTypes: [...template.paymentMethodTypes],
    gatewaysByChannel: {
      commerce: [...template.gatewaysByChannel.commerce],
      'co-own': [...template.gatewaysByChannel['co-own']],
      wallet_topup: [...template.gatewaysByChannel.wallet_topup],
      wallet_withdrawal: [...template.gatewaysByChannel.wallet_withdrawal],
    },
    payoutDefaultCurrency: template.payoutDefaultCurrency,
    payoutSupportedCurrencies: [...template.payoutSupportedCurrencies],
    payoutGatewayPriority: [...template.payoutGatewayPriority],
    postageCarriers: template.postageCarriers.map((carrier) => ({ ...carrier })),
  };
}

function resolveCountryCluster(countryCode: string): CapabilityCountryCluster {
  if (TARGET_CLUSTER_COUNTRIES.IN.has(countryCode)) {
    return 'IN';
  }

  if (TARGET_CLUSTER_COUNTRIES.US.has(countryCode)) {
    return 'US';
  }

  if (TARGET_CLUSTER_COUNTRIES.UK.has(countryCode)) {
    return 'UK';
  }

  if (MIDDLE_EAST_COUNTRIES.has(countryCode)) {
    return 'MIDDLE_EAST';
  }

  if (CHINA_NEARBY_COUNTRIES.has(countryCode)) {
    return 'CHINA_NEARBY';
  }

  if (EUROPE_COUNTRIES.has(countryCode)) {
    return 'EUROPE';
  }

  return 'GLOBAL';
}

export function resolveCountryCapabilities(input: ResolveCountryCapabilitiesInput): UserCountryCapabilities {
  const profileCountryCode = normalizeCountryCode(input.countryCode);
  const residencyCountryCode = input.residencyCountryCode
    ? normalizeCountryCode(input.residencyCountryCode)
    : null;

  const effectiveCountryCode = residencyCountryCode ?? profileCountryCode;
  const countryCluster = resolveCountryCluster(effectiveCountryCode);
  const template = cloneTemplate(CAPABILITY_TEMPLATES[countryCluster]);

  template.defaultCurrency = template.defaultCurrency.toUpperCase();
  template.payoutDefaultCurrency = template.payoutDefaultCurrency.toUpperCase();
  template.supportedCurrencies = dedupeUpper(template.supportedCurrencies);
  template.payoutSupportedCurrencies = dedupeUpper(template.payoutSupportedCurrencies);

  if (!template.supportedCurrencies.includes(template.defaultCurrency)) {
    template.supportedCurrencies.unshift(template.defaultCurrency);
  }

  if (!template.payoutSupportedCurrencies.includes(template.payoutDefaultCurrency)) {
    template.payoutSupportedCurrencies.unshift(template.payoutDefaultCurrency);
  }

  return {
    policyVersion: POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    countryCode: profileCountryCode,
    residencyCountryCode,
    effectiveCountryCode,
    countryCluster,
    jurisdictionGroups: countryToJurisdictionGroups(effectiveCountryCode),
    currency: {
      defaultCurrency: template.defaultCurrency,
      supportedCurrencies: template.supportedCurrencies,
    },
    payments: {
      stableCoinEnabled: template.stableCoinEnabled,
      methodTypes: template.paymentMethodTypes,
      gatewaysByChannel: template.gatewaysByChannel,
    },
    payouts: {
      defaultCurrency: template.payoutDefaultCurrency,
      supportedCurrencies: template.payoutSupportedCurrencies,
      gatewayPriority: template.payoutGatewayPriority,
    },
    postage: {
      carriers: template.postageCarriers,
    },
  };
}
