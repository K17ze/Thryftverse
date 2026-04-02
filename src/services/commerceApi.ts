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
  totalGbp: number;
  status: string;
  addressId: number | null;
  paymentMethodId: number | null;
  createdAt: string;
  updatedAt: string;
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

interface PayOrderResponse {
  ok: true;
  id: string;
  status: string;
  updatedAt: string;
}

interface ListOrdersResponse {
  ok: true;
  items: Array<{
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    listingTitle: string;
    listingImageUrl: string | null;
    status: string;
    totalGbp: number;
    createdAt: string;
  }>;
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
  buyerProtectionFeeGbp?: number;
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
