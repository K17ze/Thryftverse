export type SupportedCurrencyCode =
  | 'GBP'
  | 'USD'
  | 'EUR'
  | 'NGN'
  | 'JPY'
  | 'CAD'
  | 'AUD'
  | 'AED'
  | 'INR';

export interface CurrencyMeta {
  code: SupportedCurrencyCode;
  name: string;
  symbol: string;
  locale: string;
  goldRatePerGram: number;
}

export const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = 'GBP';

export const CURRENCIES: Record<SupportedCurrencyCode, CurrencyMeta> = {
  GBP: {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£',
    locale: 'en-GB',
    goldRatePerGram: 75.2,
  },
  USD: {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    locale: 'en-US',
    goldRatePerGram: 95.4,
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    locale: 'de-DE',
    goldRatePerGram: 88.1,
  },
  NGN: {
    code: 'NGN',
    name: 'Nigerian Naira',
    symbol: '₦',
    locale: 'en-NG',
    goldRatePerGram: 72500,
  },
  JPY: {
    code: 'JPY',
    name: 'Japanese Yen',
    symbol: '¥',
    locale: 'ja-JP',
    goldRatePerGram: 14380,
  },
  CAD: {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: '$',
    locale: 'en-CA',
    goldRatePerGram: 129.6,
  },
  AUD: {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: '$',
    locale: 'en-AU',
    goldRatePerGram: 145.7,
  },
  AED: {
    code: 'AED',
    name: 'UAE Dirham',
    symbol: 'د.إ',
    locale: 'ar-AE',
    goldRatePerGram: 350.4,
  },
  INR: {
    code: 'INR',
    name: 'Indian Rupee',
    symbol: '₹',
    locale: 'en-IN',
    goldRatePerGram: 7940,
  },
};
