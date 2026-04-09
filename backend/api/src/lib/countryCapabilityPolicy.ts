import type {
  CapabilityPaymentChannel,
  CapabilityPaymentMethodType,
  UserCountryCapabilities,
} from './countryCapabilities.js';

function normalizeUpper(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toUpperCase();
}

export function isPaymentMethodTypeAllowed(
  capabilities: UserCountryCapabilities,
  methodType: CapabilityPaymentMethodType
): boolean {
  return capabilities.payments.methodTypes.includes(methodType);
}

export function getAllowedGatewayIds(
  capabilities: UserCountryCapabilities,
  channel?: CapabilityPaymentChannel
): string[] {
  const gateways = channel
    ? capabilities.payments.gatewaysByChannel[channel]
    : Object.values(capabilities.payments.gatewaysByChannel).flat();

  return Array.from(new Set(gateways));
}

export function resolveChannelGateway(
  capabilities: UserCountryCapabilities,
  channel: CapabilityPaymentChannel,
  requestedGatewayId: string | null | undefined,
  fallbackGatewayId: string
): string {
  const requested = requestedGatewayId?.trim();
  if (requested) {
    return requested;
  }

  const capabilityDefault = capabilities.payments.gatewaysByChannel[channel]?.[0];
  return capabilityDefault ?? fallbackGatewayId;
}

export function isGatewayAllowedForChannel(
  capabilities: UserCountryCapabilities,
  channel: CapabilityPaymentChannel,
  gatewayId: string
): boolean {
  const configuredGateways = capabilities.payments.gatewaysByChannel[channel] ?? [];
  if (configuredGateways.length === 0) {
    return true;
  }

  const normalizedGatewayId = gatewayId.trim();
  return configuredGateways.some((configuredGateway) => configuredGateway === normalizedGatewayId);
}

export interface ResolvePayoutDefaultsInput {
  gatewayId?: string | null;
  currency?: string | null;
  countryCode?: string | null;
  fallbackGatewayId?: string;
}

export interface ResolvedPayoutDefaults {
  gatewayId: string;
  currency: string;
  countryCode: string;
}

export function resolvePayoutPolicyDefaults(
  capabilities: UserCountryCapabilities,
  input: ResolvePayoutDefaultsInput = {}
): ResolvedPayoutDefaults {
  const fallbackGatewayId = input.fallbackGatewayId ?? 'stripe_americas';

  const requestedGateway = input.gatewayId?.trim();
  const gatewayId = requestedGateway
    ?? capabilities.payouts.gatewayPriority[0]
    ?? fallbackGatewayId;

  const currency =
    normalizeUpper(input.currency)
    ?? capabilities.payouts.defaultCurrency.toUpperCase();

  const countryCode =
    normalizeUpper(input.countryCode)
    ?? capabilities.effectiveCountryCode.toUpperCase();

  return {
    gatewayId,
    currency,
    countryCode,
  };
}

export function isPayoutCurrencyAllowed(
  capabilities: UserCountryCapabilities,
  currency: string
): boolean {
  const normalizedCurrency = currency.trim().toUpperCase();
  return capabilities.payouts.supportedCurrencies.includes(normalizedCurrency);
}

export function isPayoutGatewayAllowed(
  capabilities: UserCountryCapabilities,
  gatewayId: string
): boolean {
  const configuredGateways = capabilities.payouts.gatewayPriority;
  if (configuredGateways.length === 0) {
    return true;
  }

  const normalizedGatewayId = gatewayId.trim();
  return configuredGateways.some((configuredGateway) => configuredGateway === normalizedGatewayId);
}
