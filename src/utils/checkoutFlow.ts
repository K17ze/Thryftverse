export interface CheckoutSavedAddress {
  name: string;
  street: string;
  city: string;
  postcode: string;
}

export interface CheckoutSavedPaymentMethod {
  type: 'card' | 'bank_account';
  label: string;
  details?: string;
}

export function isCheckoutReady(
  savedAddress: CheckoutSavedAddress | null | undefined,
  savedPaymentMethod: CheckoutSavedPaymentMethod | null | undefined
) {
  return Boolean(savedAddress && savedPaymentMethod);
}

export function buildCardPaymentMethod(
  cardLast4: string,
  expiry: string,
  brand: string = 'Visa'
): CheckoutSavedPaymentMethod {
  const normalizedLast4 = cardLast4.replace(/\D/g, '').slice(-4).padStart(4, '0');

  return {
    type: 'card',
    label: `${brand} •••• ${normalizedLast4}`,
    details: `Expires ${expiry}`,
  };
}

export function buildBankAccountPaymentMethod(
  accountLast4: string,
  sortCode: string
): CheckoutSavedPaymentMethod {
  const normalizedLast4 = accountLast4.replace(/\D/g, '').slice(-4).padStart(4, '0');

  return {
    type: 'bank_account',
    label: `Bank •••• ${normalizedLast4}`,
    details: `Sort code ${sortCode}`,
  };
}