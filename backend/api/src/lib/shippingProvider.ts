import crypto from 'node:crypto';
import { config } from '../config.js';
import type { CapabilityCarrier } from './countryCapabilities.js';

export type ShippingCarrierProvider = 'evri' | 'delhivery' | 'dhl' | 'aramex' | 'easyship';

export type NormalizedParcelEventType =
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'collection_confirmed'
  | 'delivery_failed'
  | 'returned';

export interface ShippingQuote {
  carrierId: string;
  carrierLabel: string;
  priceGbp: number;
  etaMinDays: number;
  etaMaxDays: number;
  tracking: boolean;
  live: boolean;
  source: 'live' | 'fallback';
  metadata: Record<string, unknown>;
}

export interface ShippingQuoteRequest {
  preferredCarriers: CapabilityCarrier[];
  originPostcode: string;
  destinationPostcode: string;
  parcelWeightKg?: number;
  declaredValueGbp?: number;
}

export interface ShippingQuoteResult {
  source: 'live' | 'fallback';
  quotes: ShippingQuote[];
}

export interface ShipmentRequest {
  orderId: string;
  carrierId: string;
  carrierLabel?: string;
  originPostcode: string;
  destinationPostcode: string;
  parcelWeightKg?: number;
  declaredValueGbp?: number;
  recipientName?: string;
}

export interface ShipmentResult {
  provider: ShippingCarrierProvider | 'fallback';
  carrierId: string;
  carrierLabel: string;
  trackingNumber: string;
  labelUrl: string | null;
  priceGbp: number;
  live: boolean;
  metadata: Record<string, unknown>;
}

export interface NormalizedShippingWebhookEvent {
  provider: ShippingCarrierProvider;
  providerEventId: string;
  eventType: NormalizedParcelEventType;
  trackingNumber: string | null;
  orderId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface ShippingWebhookVerificationResult {
  verified: boolean;
  reason?: string;
  event?: NormalizedShippingWebhookEvent;
}

interface ProviderConfig {
  provider: ShippingCarrierProvider;
  apiKey: string | null;
  apiBaseUrl: string | null;
  webhookSecret: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function providerConfig(provider: ShippingCarrierProvider): ProviderConfig {
  if (provider === 'evri') {
    return {
      provider,
      apiKey: config.evriApiKey,
      apiBaseUrl: config.evriApiBaseUrl,
      webhookSecret: config.evriWebhookSecret,
    };
  }

  if (provider === 'delhivery') {
    return {
      provider,
      apiKey: config.delhiveryApiKey,
      apiBaseUrl: config.delhiveryApiBaseUrl,
      webhookSecret: config.delhiveryWebhookSecret,
    };
  }

  if (provider === 'dhl') {
    return {
      provider,
      apiKey: config.dhlApiKey,
      apiBaseUrl: config.dhlApiBaseUrl,
      webhookSecret: config.dhlWebhookSecret,
    };
  }

  if (provider === 'aramex') {
    return {
      provider,
      apiKey: config.aramexApiKey,
      apiBaseUrl: config.aramexApiBaseUrl,
      webhookSecret: config.aramexWebhookSecret,
    };
  }

  return {
    provider,
    apiKey: config.easyshipApiKey,
    apiBaseUrl: config.easyshipApiBaseUrl,
    webhookSecret: config.easyshipWebhookSecret,
  };
}

function directProviderForCarrierId(normalizedCarrierId: string): ShippingCarrierProvider | null {
  if (normalizedCarrierId.includes('easyship')
    || normalizedCarrierId.includes('easypost')
    || normalizedCarrierId.includes('shippo')
    || normalizedCarrierId.includes('pirate_ship')
    || normalizedCarrierId.includes('pirateship')) {
    return 'easyship';
  }

  if (normalizedCarrierId.includes('evri') || normalizedCarrierId.includes('royal_mail')) {
    return 'evri';
  }

  if (normalizedCarrierId.includes('delhivery') || normalizedCarrierId.includes('bluedart') || normalizedCarrierId.includes('india_post')) {
    return 'delhivery';
  }

  if (normalizedCarrierId.includes('aramex') || normalizedCarrierId.includes('fetchr')) {
    return 'aramex';
  }

  if (normalizedCarrierId.includes('dhl') || normalizedCarrierId.includes('sf_express') || normalizedCarrierId.includes('cainiao')) {
    return 'dhl';
  }

  return null;
}

function providerForCarrierId(carrierId: string): ShippingCarrierProvider | null {
  const normalized = carrierId.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const directProvider = directProviderForCarrierId(normalized);
  if (directProvider && isProviderLiveConfigured(directProvider)) {
    return directProvider;
  }

  if (isProviderLiveConfigured('easyship')) {
    return 'easyship';
  }

  return directProvider;
}

function isProviderLiveConfigured(provider: ShippingCarrierProvider): boolean {
  const resolved = providerConfig(provider);
  return Boolean(resolved.apiKey && resolved.apiBaseUrl);
}

function normalizeCarrierLabel(carrierId: string, fallbackLabel?: string): string {
  if (fallbackLabel && fallbackLabel.trim().length > 0) {
    return fallbackLabel;
  }

  const cleaned = carrierId
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Shipping';
  }

  return cleaned
    .split(' ')
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}

function postcodeDistanceFactor(originPostcode: string, destinationPostcode: string): number {
  const from = originPostcode.replace(/\s+/g, '').toUpperCase();
  const to = destinationPostcode.replace(/\s+/g, '').toUpperCase();

  if (!from || !to || from === to) {
    return 0;
  }

  const fromPrefix = from.slice(0, 3);
  const toPrefix = to.slice(0, 3);

  if (fromPrefix === toPrefix) {
    return 0.04;
  }

  let distanceSeed = 0;
  const maxLength = Math.max(fromPrefix.length, toPrefix.length);
  for (let index = 0; index < maxLength; index += 1) {
    distanceSeed += Math.abs((fromPrefix.charCodeAt(index) || 0) - (toPrefix.charCodeAt(index) || 0));
  }

  return Math.min(0.38, 0.08 + (distanceSeed % 40) / 100);
}

function fallbackQuoteForCarrier(
  carrier: CapabilityCarrier,
  input: ShippingQuoteRequest
): ShippingQuote {
  const distanceFactor = postcodeDistanceFactor(input.originPostcode, input.destinationPostcode);
  const weightFactor = input.parcelWeightKg ? Math.min(0.3, Math.max(0, input.parcelWeightKg - 0.35) * 0.09) : 0;
  const valueFactor = input.declaredValueGbp ? Math.min(0.25, input.declaredValueGbp / 4000) : 0;

  const dynamicMultiplier = 1 + distanceFactor + weightFactor + valueFactor;
  const fallbackPrice = roundTo(Math.max(0.95, carrier.priceFromGbp * dynamicMultiplier), 2);

  return {
    carrierId: carrier.id,
    carrierLabel: carrier.label,
    priceGbp: fallbackPrice,
    etaMinDays: carrier.etaMinDays,
    etaMaxDays: carrier.etaMaxDays,
    tracking: carrier.tracking,
    live: false,
    source: 'fallback',
    metadata: {
      reason: 'missing_or_unavailable_carrier_credentials',
      distanceFactor,
      weightFactor,
      valueFactor,
    },
  };
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 5_000
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    return asRecord(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickFirstNumber(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const value = asNumber(candidate);
    if (value !== null && value > 0) {
      return value;
    }
  }

  return null;
}

function pickFirstString(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) {
      return value;
    }
  }

  return null;
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }

  return asRecord(value);
}

function providerAuthHeaders(provider: ShippingCarrierProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (provider === 'delhivery') {
    headers['X-API-Key'] = apiKey;
  } else if (provider === 'dhl') {
    headers['DHL-API-Key'] = apiKey;
  } else if (provider === 'aramex') {
    headers['X-API-Key'] = apiKey;
  }

  return headers;
}

function quoteEndpointPaths(provider: ShippingCarrierProvider): string[] {
  if (provider === 'easyship') {
    return ['/rates', '/2024-09/rates'];
  }

  if (provider === 'evri') {
    return ['/v1/quotes', '/quotes'];
  }

  if (provider === 'delhivery') {
    return ['/api/kinko/v1/quote', '/v1/quotes', '/quotes'];
  }

  if (provider === 'dhl') {
    return ['/shipments/rates', '/v1/rates', '/quotes'];
  }

  return ['/shipping/quotes', '/v1/quotes', '/quotes'];
}

function shipmentEndpointPaths(provider: ShippingCarrierProvider): string[] {
  if (provider === 'easyship') {
    return ['/shipments', '/2024-09/shipments'];
  }

  if (provider === 'evri') {
    return ['/v1/shipments', '/shipments'];
  }

  if (provider === 'delhivery') {
    return ['/api/cmu/create', '/v1/shipments', '/shipments'];
  }

  if (provider === 'dhl') {
    return ['/shipments', '/v1/shipments'];
  }

  return ['/shipping/shipments', '/v1/shipments', '/shipments'];
}

function quoteRequestBody(
  provider: ShippingCarrierProvider,
  carrier: CapabilityCarrier,
  input: ShippingQuoteRequest
): Record<string, unknown> {
  const parcelWeightKg = input.parcelWeightKg ?? 0.4;

  if (provider === 'easyship') {
    const inferredCountry = inferCountryAlpha2FromCarrierId(carrier.id);

    return {
      origin_address: {
        postal_code: input.originPostcode,
        country_alpha2: inferredCountry,
      },
      destination_address: {
        postal_code: input.destinationPostcode,
        country_alpha2: inferredCountry,
      },
      incoterms: 'DDU',
      insurance: {
        is_insured: false,
      },
      courier_settings: {
        apply_shipping_rules: true,
      },
      shipping_settings: {
        units: {
          weight: 'kg',
          dimensions: 'cm',
        },
      },
      parcels: [
        {
          total_actual_weight: parcelWeightKg,
          items: [
            {
              description: 'Order parcel',
              quantity: 1,
              declared_currency: 'GBP',
              declared_customs_value: Math.max(1, roundTo(input.declaredValueGbp ?? 20, 2)),
            },
          ],
        },
      ],
      calculate_tax_and_duties: false,
    };
  }

  if (provider === 'evri') {
    return {
      carrierCode: carrier.id,
      collectionPostcode: input.originPostcode,
      deliveryPostcode: input.destinationPostcode,
      parcel: {
        weightKg: parcelWeightKg,
        declaredValueGbp: input.declaredValueGbp ?? null,
      },
    };
  }

  if (provider === 'delhivery') {
    return {
      pickup_postcode: input.originPostcode,
      delivery_postcode: input.destinationPostcode,
      carrier_id: carrier.id,
      weight_kg: parcelWeightKg,
      declared_value_gbp: input.declaredValueGbp ?? null,
    };
  }

  if (provider === 'dhl') {
    return {
      productCode: carrier.id,
      origin: {
        postalCode: input.originPostcode,
      },
      destination: {
        postalCode: input.destinationPostcode,
      },
      packages: [
        {
          weight: parcelWeightKg,
        },
      ],
      declaredValue: {
        currencyCode: 'GBP',
        value: input.declaredValueGbp ?? null,
      },
    };
  }

  return {
    carrierCode: carrier.id,
    originPostalCode: input.originPostcode,
    destinationPostalCode: input.destinationPostcode,
    weightKg: parcelWeightKg,
    declaredValueGbp: input.declaredValueGbp ?? null,
  };
}

function shipmentRequestBody(
  provider: ShippingCarrierProvider,
  input: ShipmentRequest
): Record<string, unknown> {
  const parcelWeightKg = input.parcelWeightKg ?? 0.4;

  if (provider === 'easyship') {
    const inferredCountry = inferCountryAlpha2FromCarrierId(input.carrierId);

    return {
      origin_address: {
        postal_code: input.originPostcode,
        country_alpha2: inferredCountry,
      },
      destination_address: {
        postal_code: input.destinationPostcode,
        country_alpha2: inferredCountry,
        name: input.recipientName ?? undefined,
      },
      incoterms: 'DDU',
      insurance: {
        is_insured: false,
      },
      metadata: {
        orderId: input.orderId,
        carrierHint: input.carrierId,
      },
      shipping_settings: {
        units: {
          weight: 'kg',
          dimensions: 'cm',
        },
      },
      parcels: [
        {
          total_actual_weight: parcelWeightKg,
          items: [
            {
              description: 'Order parcel',
              quantity: 1,
              declared_currency: 'GBP',
              declared_customs_value: Math.max(1, roundTo(input.declaredValueGbp ?? 20, 2)),
            },
          ],
        },
      ],
    };
  }

  if (provider === 'evri') {
    return {
      orderId: input.orderId,
      carrierCode: input.carrierId,
      collectionPostcode: input.originPostcode,
      deliveryPostcode: input.destinationPostcode,
      recipientName: input.recipientName ?? null,
      parcel: {
        weightKg: parcelWeightKg,
        declaredValueGbp: input.declaredValueGbp ?? null,
      },
    };
  }

  if (provider === 'delhivery') {
    return {
      order_id: input.orderId,
      carrier_id: input.carrierId,
      pickup_postcode: input.originPostcode,
      delivery_postcode: input.destinationPostcode,
      recipient_name: input.recipientName ?? null,
      weight_kg: parcelWeightKg,
      declared_value_gbp: input.declaredValueGbp ?? null,
    };
  }

  if (provider === 'dhl') {
    return {
      shipmentReference: input.orderId,
      productCode: input.carrierId,
      shipper: {
        postalCode: input.originPostcode,
      },
      receiver: {
        postalCode: input.destinationPostcode,
        name: input.recipientName ?? null,
      },
      packages: [
        {
          weight: parcelWeightKg,
        },
      ],
      declaredValue: {
        currencyCode: 'GBP',
        value: input.declaredValueGbp ?? null,
      },
    };
  }

  return {
    orderId: input.orderId,
    carrierCode: input.carrierId,
    originPostalCode: input.originPostcode,
    destinationPostalCode: input.destinationPostcode,
    recipientName: input.recipientName ?? null,
    weightKg: parcelWeightKg,
    declaredValueGbp: input.declaredValueGbp ?? null,
  };
}

function inferCountryAlpha2FromCarrierId(carrierId: string): string {
  const normalized = carrierId.trim().toLowerCase();

  if (normalized.includes('delhivery') || normalized.includes('bluedart') || normalized.includes('india_post')) {
    return 'IN';
  }

  if (normalized.includes('usps') || normalized.includes('ups') || normalized.includes('fedex')) {
    return 'US';
  }

  if (normalized.includes('aramex') || normalized.includes('fetchr') || normalized.includes('smsa')) {
    return 'AE';
  }

  if (normalized.includes('dhl') || normalized.includes('gls') || normalized.includes('dpd_eu') || normalized.includes('postnl')) {
    return 'DE';
  }

  return 'GB';
}

async function fetchJsonFromProviderEndpoints(
  apiBaseUrl: string,
  endpointPaths: string[],
  init: RequestInit
): Promise<Record<string, unknown> | null> {
  const normalizedBaseUrl = apiBaseUrl.replace(/\/$/, '');

  for (const endpointPath of endpointPaths) {
    const endpoint = endpointPath.startsWith('http')
      ? endpointPath
      : `${normalizedBaseUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

    const payload = await fetchJsonWithTimeout(endpoint, init);
    if (payload) {
      return payload;
    }
  }

  return null;
}

function quoteDataFromPayload(
  provider: ShippingCarrierProvider,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const root = asRecord(payload);

  if (provider === 'easyship') {
    const data = asRecord(root.data ?? root.result ?? root);
    const rate = firstRecord(data.rates ?? data.rate ?? root.rates ?? root.rate);
    if (Object.keys(rate).length > 0) {
      return rate;
    }

    return data;
  }

  if (provider === 'dhl') {
    const data = asRecord(root.data ?? root.result ?? root);
    const product = firstRecord(data.products ?? root.products);
    if (Object.keys(product).length > 0) {
      return product;
    }

    return data;
  }

  if (provider === 'delhivery') {
    const data = asRecord(root.data ?? root.result ?? root);
    const option = firstRecord(data.options ?? data.quotes ?? root.options ?? root.quotes);
    if (Object.keys(option).length > 0) {
      return option;
    }

    return data;
  }

  return asRecord(root.data ?? root.quote ?? root.rate ?? root.result ?? root);
}

function resolveQuotePrice(provider: ShippingCarrierProvider, data: Record<string, unknown>): number | null {
  const priceObject = asRecord(data.price);
  const totalPriceObject = asRecord(data.totalPrice);
  const shippingRateObject = asRecord(data.shipping_rate ?? data.shippingRate);
  const totalChargeObject = asRecord(shippingRateObject.total_charge ?? shippingRateObject.totalCharge);

  if (provider === 'easyship') {
    return pickFirstNumber([
      totalChargeObject.amount,
      shippingRateObject.charge,
      shippingRateObject.amount,
      data.total_charge,
      data.shipping_fee,
      data.price,
    ]);
  }

  if (provider === 'evri') {
    return pickFirstNumber([
      data.totalPriceGbp,
      data.total_price_gbp,
      priceObject.gbp,
      priceObject.amount,
      data.priceGbp,
      data.amount_gbp,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstNumber([
      data.total_amount_gbp,
      data.total_amount,
      data.shipping_fee_gbp,
      data.shipping_fee,
      data.rate,
      data.price,
      priceObject.amount,
    ]);
  }

  if (provider === 'dhl') {
    return pickFirstNumber([
      totalPriceObject.amount,
      totalPriceObject.value,
      data.totalPriceGbp,
      data.total_price_gbp,
      data.price,
    ]);
  }

  return pickFirstNumber([
    data.totalAmountGbp,
    data.total_amount_gbp,
    data.shippingAmountGbp,
    data.shipping_amount_gbp,
    priceObject.amount,
    data.priceGbp,
  ]);
}

function resolveQuoteEtaMinDays(provider: ShippingCarrierProvider, data: Record<string, unknown>): number | null {
  if (provider === 'easyship') {
    return pickFirstNumber([
      data.min_delivery_time,
      data.min_delivery_days,
      data.estimated_delivery_days,
      data.delivery_days,
      data.delivery_days_min,
      data.deliveryMinDays,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstNumber([
      data.estimated_delivery_days,
      data.estimated_days,
      data.eta_days,
      data.etaMinDays,
    ]);
  }

  if (provider === 'dhl') {
    return pickFirstNumber([
      data.transitDays,
      data.transit_days,
      data.deliveryDays,
      data.etaMinDays,
    ]);
  }

  return pickFirstNumber([
    data.etaMinDays,
    data.eta_min_days,
    data.deliveryMinDays,
    data.delivery_min_days,
  ]);
}

function resolveQuoteEtaMaxDays(provider: ShippingCarrierProvider, data: Record<string, unknown>): number | null {
  if (provider === 'easyship') {
    return pickFirstNumber([
      data.max_delivery_time,
      data.max_delivery_days,
      data.estimated_delivery_days,
      data.delivery_days,
      data.delivery_days_max,
      data.deliveryMaxDays,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstNumber([
      data.estimated_delivery_days,
      data.estimated_days,
      data.eta_days,
      data.etaMaxDays,
    ]);
  }

  if (provider === 'dhl') {
    return pickFirstNumber([
      data.transitDays,
      data.transit_days,
      data.deliveryDays,
      data.etaMaxDays,
    ]);
  }

  return pickFirstNumber([
    data.etaMaxDays,
    data.eta_max_days,
    data.deliveryMaxDays,
    data.delivery_max_days,
  ]);
}

function resolveQuoteRef(provider: ShippingCarrierProvider, data: Record<string, unknown>): string | null {
  if (provider === 'easyship') {
    return pickFirstString([
      data.courier_service_id,
      data.courier_id,
      data.rate_id,
      data.id,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstString([data.quote_id, data.rate_id, data.id]);
  }

  if (provider === 'dhl') {
    return pickFirstString([data.productCode, data.quoteId, data.id]);
  }

  if (provider === 'aramex') {
    return pickFirstString([data.rateId, data.quoteId, data.id]);
  }

  return pickFirstString([data.quoteRef, data.quote_id, data.id]);
}

function shipmentDataFromPayload(
  provider: ShippingCarrierProvider,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const root = asRecord(payload);

  if (provider === 'easyship') {
    const data = asRecord(root.data ?? root.result ?? root);
    const shipment = firstRecord(data.shipment ?? data.shipments ?? root.shipment ?? root.shipments);
    if (Object.keys(shipment).length > 0) {
      return shipment;
    }

    return data;
  }

  if (provider === 'dhl') {
    const data = asRecord(root.data ?? root.result ?? root);
    const shipment = firstRecord(data.shipments ?? root.shipments);
    if (Object.keys(shipment).length > 0) {
      return shipment;
    }

    return data;
  }

  if (provider === 'delhivery') {
    const data = asRecord(root.data ?? root.result ?? root);
    const packageRecord = firstRecord(data.packages ?? data.shipments ?? root.packages);
    if (Object.keys(packageRecord).length > 0) {
      return packageRecord;
    }

    return data;
  }

  return asRecord(root.data ?? root.shipment ?? root.result ?? root);
}

function resolveShipmentTrackingNumber(provider: ShippingCarrierProvider, data: Record<string, unknown>): string | null {
  if (provider === 'easyship') {
    const tracking = asRecord(data.tracking ?? data.tracking_info);

    return pickFirstString([
      data.tracking_number,
      data.trackingNumber,
      tracking.tracking_number,
      tracking.number,
      data.awb_number,
    ]);
  }

  if (provider === 'evri') {
    return pickFirstString([
      data.trackingNumber,
      data.consignmentCode,
      data.consignment_code,
      data.tracking_number,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstString([
      data.waybill,
      data.awb,
      data.awb_number,
      data.trackingNumber,
      data.tracking_number,
    ]);
  }

  if (provider === 'dhl') {
    return pickFirstString([
      data.shipmentTrackingNumber,
      data.trackingNumber,
      data.tracking_number,
      data.waybillNumber,
    ]);
  }

  return pickFirstString([
    data.awbNumber,
    data.shipmentNumber,
    data.trackingNumber,
    data.tracking_number,
  ]);
}

function resolveShipmentLabelUrl(data: Record<string, unknown>): string | null {
  const documents = firstRecord(data.documents);

  return pickFirstString([
    data.labelUrl,
    data.label_url,
    data.shipping_label_url,
    data.label,
    documents.url,
    documents.labelUrl,
  ]);
}

function resolveShipmentPrice(data: Record<string, unknown>): number {
  const price = pickFirstNumber([
    data.priceGbp,
    data.amount_gbp,
    data.shipping_fee_gbp,
    asRecord(data.price).amount,
    asRecord(data.totalPrice).amount,
  ]);

  return roundTo(Math.max(0, price ?? 0), 2);
}

function resolveShipmentRef(provider: ShippingCarrierProvider, data: Record<string, unknown>): string | null {
  if (provider === 'easyship') {
    return pickFirstString([
      data.shipment_id,
      data.easyship_shipment_id,
      data.id,
    ]);
  }

  if (provider === 'delhivery') {
    return pickFirstString([data.shipment_id, data.id, data.waybill]);
  }

  if (provider === 'dhl') {
    return pickFirstString([data.shipmentReference, data.id, data.shipmentId]);
  }

  if (provider === 'aramex') {
    return pickFirstString([data.shipmentNumber, data.id, data.awbNumber]);
  }

  return pickFirstString([data.shipmentRef, data.id, data.consignmentCode]);
}

async function attemptLiveQuote(
  carrier: CapabilityCarrier,
  input: ShippingQuoteRequest
): Promise<ShippingQuote | null> {
  const provider = providerForCarrierId(carrier.id);
  if (!provider) {
    return null;
  }

  const resolved = providerConfig(provider);
  if (!resolved.apiKey || !resolved.apiBaseUrl) {
    return null;
  }

  const payload = await fetchJsonFromProviderEndpoints(resolved.apiBaseUrl, quoteEndpointPaths(provider), {
    method: 'POST',
    headers: providerAuthHeaders(provider, resolved.apiKey),
    body: JSON.stringify(quoteRequestBody(provider, carrier, input)),
  });

  if (!payload) {
    return null;
  }

  const data = quoteDataFromPayload(provider, payload);
  const livePrice = resolveQuotePrice(provider, data);
  if (livePrice === null || livePrice <= 0) {
    return null;
  }

  const etaMinDays = Math.max(
    1,
    Math.round(resolveQuoteEtaMinDays(provider, data) ?? carrier.etaMinDays)
  );
  const etaMaxDays = Math.max(
    etaMinDays,
    Math.round(resolveQuoteEtaMaxDays(provider, data) ?? carrier.etaMaxDays)
  );

  return {
    carrierId: carrier.id,
    carrierLabel: carrier.label,
    priceGbp: roundTo(livePrice, 2),
    etaMinDays,
    etaMaxDays,
    tracking: true,
    live: true,
    source: 'live',
    metadata: {
      provider,
      quoteRef: resolveQuoteRef(provider, data),
    },
  };
}

export function isCarrierLiveConfigured(carrierId: string): boolean {
  const provider = providerForCarrierId(carrierId);
  if (!provider) {
    return false;
  }

  return isProviderLiveConfigured(provider);
}

export async function getShippingQuotes(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
  const quotes: ShippingQuote[] = [];

  for (const carrier of input.preferredCarriers) {
    const live = await attemptLiveQuote(carrier, input);
    quotes.push(live ?? fallbackQuoteForCarrier(carrier, input));
  }

  quotes.sort((left, right) => left.priceGbp - right.priceGbp);

  return {
    source: quotes.some((entry) => entry.live) ? 'live' : 'fallback',
    quotes,
  };
}

async function attemptLiveShipment(input: ShipmentRequest): Promise<ShipmentResult | null> {
  const provider = providerForCarrierId(input.carrierId);
  if (!provider) {
    return null;
  }

  const resolved = providerConfig(provider);
  if (!resolved.apiKey || !resolved.apiBaseUrl) {
    return null;
  }

  const payload = await fetchJsonFromProviderEndpoints(resolved.apiBaseUrl, shipmentEndpointPaths(provider), {
    method: 'POST',
    headers: providerAuthHeaders(provider, resolved.apiKey),
    body: JSON.stringify(shipmentRequestBody(provider, input)),
  });

  if (!payload) {
    return null;
  }

  const data = shipmentDataFromPayload(provider, payload);
  const trackingNumber = resolveShipmentTrackingNumber(provider, data);
  if (!trackingNumber) {
    return null;
  }

  const labelUrl = resolveShipmentLabelUrl(data);
  const shipmentPrice = resolveShipmentPrice(data);

  return {
    provider,
    carrierId: input.carrierId,
    carrierLabel: normalizeCarrierLabel(input.carrierId, input.carrierLabel),
    trackingNumber,
    labelUrl,
    priceGbp: shipmentPrice,
    live: true,
    metadata: {
      provider,
      shipmentRef: resolveShipmentRef(provider, data),
    },
  };
}

function fallbackShipment(input: ShipmentRequest): ShipmentResult {
  const provider = providerForCarrierId(input.carrierId);
  const trackingSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const prefix = (provider ?? 'tv').toUpperCase().slice(0, 3);
  const trackingNumber = `${prefix}-${Date.now()}-${trackingSuffix}`;

  const baseLabelUrl = config.shippingFallbackLabelBaseUrl.replace(/\/$/, '');
  const labelUrl = `${baseLabelUrl}/labels/${trackingNumber}.pdf`;

  const defaultPrice = roundTo(
    1.25 + postcodeDistanceFactor(input.originPostcode, input.destinationPostcode) * 2.4,
    2
  );

  return {
    provider: 'fallback',
    carrierId: input.carrierId,
    carrierLabel: normalizeCarrierLabel(input.carrierId, input.carrierLabel),
    trackingNumber,
    labelUrl,
    priceGbp: defaultPrice,
    live: false,
    metadata: {
      mode: 'fallback',
      reason: 'carrier_api_unavailable',
    },
  };
}

export async function createShipment(input: ShipmentRequest): Promise<ShipmentResult> {
  const live = await attemptLiveShipment(input);
  return live ?? fallbackShipment(input);
}

function headerValue(headers: Record<string, unknown>, key: string): string | null {
  const lookup = key.toLowerCase();

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== lookup) {
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

function hmacSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function timingSafeEqualHex(leftHex: string, rightHex: string): boolean {
  try {
    const left = Buffer.from(leftHex, 'hex');
    const right = Buffer.from(rightHex, 'hex');

    if (left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function timingSafeEqualBuffer(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function base64UrlToBuffer(value: string): Buffer | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

function verifyJwtHs256(token: string, secret: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const headerBuffer = base64UrlToBuffer(encodedHeader);
  if (!headerBuffer) {
    return false;
  }

  let parsedHeader: Record<string, unknown>;
  try {
    parsedHeader = asRecord(JSON.parse(headerBuffer.toString('utf8')));
  } catch {
    return false;
  }

  const algorithm = asString(parsedHeader.alg)?.toUpperCase() ?? null;
  if (algorithm !== 'HS256') {
    return false;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(signingInput, 'utf8').digest();
  const providedSignature = base64UrlToBuffer(encodedSignature);
  if (!providedSignature) {
    return false;
  }

  return timingSafeEqualBuffer(expectedSignature, providedSignature);
}

function normalizeCarrierFromPath(value: string): ShippingCarrierProvider | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'evri' || normalized === 'delhivery' || normalized === 'dhl' || normalized === 'aramex' || normalized === 'easyship') {
    return normalized;
  }

  if (normalized === 'royal_mail') {
    return 'evri';
  }

  if (normalized === 'shippo' || normalized === 'easypost' || normalized === 'pirateship' || normalized === 'pirate_ship') {
    return 'easyship';
  }

  return null;
}

function mapProviderEventType(rawEventType: string | null): NormalizedParcelEventType {
  const normalized = (rawEventType ?? '').trim().toLowerCase();

  if (normalized === 'picked_up' || normalized === 'pickup' || normalized === 'dispatched' || normalized.includes('picked_up') || normalized.includes('pickup')) {
    return 'picked_up';
  }

  if (normalized === 'in_transit' || normalized === 'transit' || normalized.includes('in_transit') || normalized.includes('transit')) {
    return 'in_transit';
  }

  if (normalized === 'out_for_delivery' || normalized.includes('out_for_delivery')) {
    return 'out_for_delivery';
  }

  if (normalized === 'collection_confirmed' || normalized.includes('collection_confirmed')) {
    return 'collection_confirmed';
  }

  if (normalized === 'delivered' || normalized === 'complete' || normalized.includes('delivered')) {
    return 'delivered';
  }

  if (normalized === 'delivery_failed' || normalized === 'failed' || normalized === 'lost' || normalized.includes('failed') || normalized.includes('lost')) {
    return 'delivery_failed';
  }

  if (normalized === 'returned' || normalized === 'return_to_sender' || normalized.includes('returned')) {
    return 'returned';
  }

  return 'in_transit';
}

function resolveWebhookSecret(provider: ShippingCarrierProvider): string | null {
  return providerConfig(provider).webhookSecret;
}

function verifyCarrierWebhookSignature(
  provider: ShippingCarrierProvider,
  headers: Record<string, unknown>,
  rawBody: string
): { ok: boolean; reason?: string } {
  const secret = resolveWebhookSecret(provider);

  if (!secret) {
    if (config.nodeEnv === 'production') {
      return {
        ok: false,
        reason: `Missing ${provider} webhook secret`,
      };
    }

    return { ok: true };
  }

  if (provider === 'easyship') {
    const jwtSignature =
      headerValue(headers, 'x-easyship-signature')
      ?? headerValue(headers, 'x-webhook-signature');

    if (!jwtSignature) {
      return {
        ok: false,
        reason: 'Missing webhook signature header',
      };
    }

    const ok = verifyJwtHs256(jwtSignature, secret);
    if (!ok) {
      return {
        ok: false,
        reason: 'Invalid shipping webhook signature',
      };
    }

    return { ok: true };
  }

  const provided =
    headerValue(headers, `x-${provider}-signature`)
    ?? headerValue(headers, 'x-signature')
    ?? headerValue(headers, 'x-webhook-signature');

  if (!provided) {
    return {
      ok: false,
      reason: 'Missing webhook signature header',
    };
  }

  const normalizedProvided = provided.replace(/^sha256=/i, '').trim();
  const expected = hmacSignature(secret, rawBody);

  if (!timingSafeEqualHex(expected, normalizedProvided)) {
    return {
      ok: false,
      reason: 'Invalid shipping webhook signature',
    };
  }

  return { ok: true };
}

export async function normalizeAndVerifyShippingWebhook(
  carrierPath: string,
  headers: Record<string, unknown>,
  rawBody: string,
  parsedBody: unknown
): Promise<ShippingWebhookVerificationResult> {
  const provider = normalizeCarrierFromPath(carrierPath);
  if (!provider) {
    return {
      verified: false,
      reason: 'Unsupported shipping carrier in webhook path',
    };
  }

  const signature = verifyCarrierWebhookSignature(provider, headers, rawBody);
  if (!signature.ok) {
    return {
      verified: false,
      reason: signature.reason,
    };
  }

  const payload = asRecord(parsedBody);
  const resource = asRecord(payload.resource ?? payload.shipment ?? payload.data);
  const metadata = {
    ...asRecord(resource.metadata),
    ...asRecord(payload.metadata),
  };

  const rawEventType =
    asString(payload.eventType)
    ?? asString(payload.event_type)
    ?? asString(payload.event)
    ?? asString(payload.type)
    ?? asString(payload.topic)
    ?? asString(resource.eventType)
    ?? asString(resource.event_type)
    ?? asString(resource.event)
    ?? asString(resource.type)
    ?? asString(payload.status)
    ?? asString(resource.status)
    ?? null;

  const trackingNumber =
    asString(payload.trackingNumber)
    ?? asString(payload.tracking_number)
    ?? asString(resource.trackingNumber)
    ?? asString(resource.tracking_number)
    ?? asString(asRecord(resource.tracking).tracking_number)
    ?? asString(metadata.trackingNumber)
    ?? asString(metadata.tracking_number)
    ?? null;

  const orderId =
    asString(payload.orderId)
    ?? asString(payload.order_id)
    ?? asString(resource.orderId)
    ?? asString(resource.order_id)
    ?? asString(resource.reference)
    ?? asString(metadata.orderId)
    ?? asString(metadata.order_id)
    ?? null;

  const occurredAtRaw =
    asString(payload.occurredAt)
    ?? asString(payload.occurred_at)
    ?? asString(payload.timestamp)
    ?? null;

  const occurredAt = occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw))
    ? new Date(occurredAtRaw).toISOString()
    : new Date().toISOString();

  const providerEventId =
    asString(payload.eventId)
    ?? asString(payload.event_id)
    ?? asString(payload.webhook_event_id)
    ?? asString(payload.id)
    ?? asString(resource.eventId)
    ?? asString(resource.event_id)
    ?? asString(resource.webhook_event_id)
    ?? asString(resource.id)
    ?? (trackingNumber
      ? `${provider}:${mapProviderEventType(rawEventType)}:${trackingNumber}`
      : crypto.createHash('sha1').update(rawBody, 'utf8').digest('hex'));

  return {
    verified: true,
    event: {
      provider,
      providerEventId,
      eventType: mapProviderEventType(rawEventType),
      trackingNumber,
      orderId,
      occurredAt,
      metadata,
      rawPayload: payload,
    },
  };
}
