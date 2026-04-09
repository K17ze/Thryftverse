import type {
  CapabilityPaymentMethodType,
  UserCountryCapabilities,
} from '../services/capabilitiesApi';

export function toClusterLabel(cluster: string): string {
  return cluster
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatCountryPolicyScope(
  capabilities: Pick<UserCountryCapabilities, 'effectiveCountryCode' | 'countryCluster'> | null | undefined
): string | null {
  if (!capabilities) {
    return null;
  }

  return `${capabilities.effectiveCountryCode} · ${toClusterLabel(capabilities.countryCluster)}`;
}

export function isPaymentMethodAllowed(
  capabilities: Pick<UserCountryCapabilities, 'payments'> | null | undefined,
  methodType: CapabilityPaymentMethodType,
  fallback = true
): boolean {
  if (!capabilities) {
    return fallback;
  }

  return capabilities.payments.methodTypes.includes(methodType);
}

export function formatPayoutPolicyHint(capabilities: UserCountryCapabilities | null | undefined): string | null {
  if (!capabilities) {
    return null;
  }

  return `Payout default ${capabilities.payouts.defaultCurrency} · Supported ${capabilities.payouts.supportedCurrencies.join(', ')}`;
}
