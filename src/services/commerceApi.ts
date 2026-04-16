import { fetchJson } from '../lib/apiClient';

export interface CommerceAddress {
  id: number;
  userId: string;
  name: string;
  street: string;
  city: string;
  postcode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommercePaymentMethod {
  id: number;
  userId: string;
  type: 'card' | 'bank_account';
  label: string;
  details: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceOrder {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  subtotalGbp: number;
  buyerProtectionFeeGbp: number;
  platformChargeGbp: number;
  postageFeeGbp: number;
  totalGbp: number;
  status: string;
  addressId: number | null;
  paymentMethodId: number | null;
  shippingCarrierId: string | null;
  shippingProvider: string | null;
  trackingNumber: string | null;
  shippingLabelUrl: string | null;
  shippingQuoteGbp: number | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingQuoteItem {
  carrierId: string;
  label: string;
  priceFromGbp: number;
  etaMinDays: number;
  etaMaxDays: number;
  tracking: boolean;
  live: boolean;
  source: 'live' | 'fallback';
  metadata: Record<string, unknown>;
}

export interface ServiceabilityCarrier {
  id: string;
  label: string;
  priceFromGbp: number;
  etaMinDays: number;
  etaMaxDays: number;
  tracking: boolean;
  liveConfigured: boolean;
}

export interface ShippingServiceabilityResponse {
  ok: true;
  capabilities: {
    countryCluster: string;
    countryCode: string;
    effectiveCountryCode: string;
    policyVersion: string;
  };
  serviceability: {
    fromPostcode: string | null;
    toPostcode: string | null;
    serviceable: boolean;
  };
  carriers: ServiceabilityCarrier[];
}

interface ListAddressesResponse {
  ok: true;
  items: CommerceAddress[];
}

interface CreateAddressResponse {
  ok: true;
  item: CommerceAddress;
}

interface ListPaymentMethodsResponse {
  ok: true;
  items: CommercePaymentMethod[];
}

interface CreatePaymentMethodResponse {
  ok: true;
  item: CommercePaymentMethod;
}

interface CreateOrderResponse {
  ok: true;
  order: CommerceOrder;
}

interface GetOrderResponse {
  ok: true;
  order: CommerceOrder;
}

interface ShippingQuoteResponse {
  ok: true;
  source: 'live' | 'fallback';
  originPostcode: string;
  destinationPostcode: string;
  recommendedQuote: ShippingQuoteItem | null;
  quotes: ShippingQuoteItem[];
}

interface PayOrderResponse {
  ok: true;
  id: string;
  status: string;
  updatedAt: string;
}

export interface PaymentIntentStatusResponse {
  intentId: string;
  gatewayId: string;
  status: string;
  clientSecret: string | null;
  nextActionUrl: string | null;
}

export interface CommerceUserOrder {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  listingTitle: string;
  listingImageUrl: string | null;
  status: string;
  postageFeeGbp: number;
  totalGbp: number;
  trackingNumber: string | null;
  shippingProvider: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface OrderParcelEvent {
  id: number;
  provider: string;
  eventType:
    | 'picked_up'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'collection_confirmed'
    | 'delivery_failed'
    | 'returned';
  providerEventId: string | null;
  trackingId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  payload: Record<string, unknown>;
}

interface ListOrdersResponse {
  ok: true;
  items: CommerceUserOrder[];
}

interface ListOrderParcelEventsResponse {
  ok: true;
  source: 'orders_with_parcel_events' | 'orders_status_only';
  order: {
    id: string;
    status: string;
    trackingNumber: string | null;
    shippingProvider: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  };
  items: OrderParcelEvent[];
}

export interface CreateAddressInput {
  name: string;
  street: string;
  city: string;
  postcode: string;
  isDefault?: boolean;
}

export interface CreatePaymentMethodInput {
  type: 'card' | 'bank_account';
  label: string;
  details?: string;
  isDefault?: boolean;
}

export interface CreateOrderInput {
  buyerId: string;
  listingId: string;
  addressId?: number;
  paymentMethodId?: number;
  platformChargeGbp?: number;
  buyerProtectionFeeGbp?: number;
  postageFeeGbp?: number;
  shippingCarrierId?: string;
}

export interface ShippingQuoteInput {
  buyerId: string;
  listingId?: string;
  sellerId?: string;
  addressId?: number;
  originPostcode?: string;
  destinationPostcode?: string;
  preferredCarrierId?: string;
  parcelWeightKg?: number;
  declaredValueGbp?: number;
}

export interface ShippingServiceabilityInput {
  buyerId?: string;
  countryCode?: string;
  residencyCountryCode?: string | null;
}

export async function listUserAddresses(userId: string): Promise<CommerceAddress[]> {
  const payload = await fetchJson<ListAddressesResponse>(`/users/${encodeURIComponent(userId)}/addresses`);
  return payload.items;
}

export async function createUserAddress(
  userId: string,
  input: CreateAddressInput
): Promise<CommerceAddress> {
  const payload = await fetchJson<CreateAddressResponse>(
    `/users/${encodeURIComponent(userId)}/addresses`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  return payload.item;
}

export async function deleteUserAddress(userId: string, addressId: number): Promise<void> {
  await fetchJson<{ ok: true }>(
    `/users/${encodeURIComponent(userId)}/addresses/${addressId}`,
    { method: 'DELETE' }
  );
}

export async function listUserPaymentMethods(userId: string): Promise<CommercePaymentMethod[]> {
  const payload = await fetchJson<ListPaymentMethodsResponse>(
    `/users/${encodeURIComponent(userId)}/payment-methods`
  );
  return payload.items;
}

export async function createUserPaymentMethod(
  userId: string,
  input: CreatePaymentMethodInput
): Promise<CommercePaymentMethod> {
  const payload = await fetchJson<CreatePaymentMethodResponse>(
    `/users/${encodeURIComponent(userId)}/payment-methods`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  return payload.item;
}

export async function deleteUserPaymentMethod(userId: string, paymentMethodId: number): Promise<void> {
  await fetchJson<{ ok: true }>(
    `/users/${encodeURIComponent(userId)}/payment-methods/${paymentMethodId}`,
    { method: 'DELETE' }
  );
}

export async function createOrder(input: CreateOrderInput): Promise<CommerceOrder> {
  const payload = await fetchJson<CreateOrderResponse>('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return payload.order;
}

export async function getOrder(orderId: string): Promise<CommerceOrder> {
  const payload = await fetchJson<GetOrderResponse>(`/orders/${encodeURIComponent(orderId)}`);
  return payload.order;
}

export async function getOrderParcelEvents(orderId: string): Promise<OrderParcelEvent[]> {
  const payload = await fetchJson<ListOrderParcelEventsResponse>(
    `/orders/${encodeURIComponent(orderId)}/parcel/events`
  );
  return payload.items;
}

export async function getShippingQuote(input: ShippingQuoteInput): Promise<ShippingQuoteResponse> {
  return fetchJson<ShippingQuoteResponse>('/shipping/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function checkShippingServiceability(
  input: ShippingServiceabilityInput
): Promise<ShippingServiceabilityResponse> {
  return fetchJson<ShippingServiceabilityResponse>('/shipping/serviceability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function createCommercePaymentIntent(
  input: { orderId: string }
): Promise<PaymentIntentStatusResponse> {
  const payload = await fetchJson<{ ok: true; intent: PaymentIntentStatusResponse }>(
    '/payments/intents',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'commerce',
        orderId: input.orderId,
      }),
    }
  );

  return payload.intent;
}

export async function getPaymentIntentStatus(intentId: string): Promise<PaymentIntentStatusResponse> {
  const payload = await fetchJson<{ ok: true; intent: PaymentIntentStatusResponse }>(
    `/payments/intents/${encodeURIComponent(intentId)}`
  );

  return payload.intent;
}

export async function payOrder(orderId: string): Promise<PayOrderResponse> {
  return fetchJson<PayOrderResponse>(`/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function listUserOrders(
  userId: string,
  role: 'buyer' | 'seller' | 'all' = 'all',
  limit = 50
): Promise<ListOrdersResponse['items']> {
  const payload = await fetchJson<ListOrdersResponse>(
    `/users/${encodeURIComponent(userId)}/orders?role=${encodeURIComponent(role)}&limit=${limit}`
  );
  return payload.items;
}
