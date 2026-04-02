import {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  SupportedCurrencyCode,
} from '../constants/currencies';

export type CurrencyDisplayMode = 'ize' | 'fiat' | 'both';

export const IZE_DECIMALS = 6;
export const IZE_SYMBOL = '1ze';

export type GoldRates = Record<SupportedCurrencyCode, number>;

export const DEFAULT_GOLD_RATES: GoldRates = {
  GBP: CURRENCIES.GBP.goldRatePerGram,
  USD: CURRENCIES.USD.goldRatePerGram,
  EUR: CURRENCIES.EUR.goldRatePerGram,
  NGN: CURRENCIES.NGN.goldRatePerGram,
  JPY: CURRENCIES.JPY.goldRatePerGram,
  CAD: CURRENCIES.CAD.goldRatePerGram,
  AUD: CURRENCIES.AUD.goldRatePerGram,
  AED: CURRENCIES.AED.goldRatePerGram,
  INR: CURRENCIES.INR.goldRatePerGram,
};

const FALLBACK_CURRENCY = DEFAULT_CURRENCY_CODE;

function getRate(currencyCode: SupportedCurrencyCode, goldRates?: Partial<GoldRates>) {
  return goldRates?.[currencyCode] ?? DEFAULT_GOLD_RATES[currencyCode];
}

export function toFiat(
  izeAmount: number,
  currencyCode: SupportedCurrencyCode = FALLBACK_CURRENCY,
  goldRates?: Partial<GoldRates>
): number {
  return izeAmount * getRate(currencyCode, goldRates);
}

export function toIze(
  fiatAmount: number,
  currencyCode: SupportedCurrencyCode = FALLBACK_CURRENCY,
  goldRates?: Partial<GoldRates>
): number {
  const rate = getRate(currencyCode, goldRates);
  if (!rate) {
    return 0;
  }

  return fiatAmount / rate;
}

export function formatIzeAmount(value: number, fractionDigits: number = IZE_DECIMALS): string {
  return `${value.toFixed(fractionDigits)} ${IZE_SYMBOL}`;
}

export function formatFiatAmount(
  value: number,
  currencyCode: SupportedCurrencyCode,
  fractionDigits: number = 2
): string {
  const meta = CURRENCIES[currencyCode];

  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${meta.symbol}${value.toFixed(fractionDigits)}`;
  }
}

export interface FormatPriceParams {
  izeAmount: number;
  displayMode: CurrencyDisplayMode;
  currencyCode: SupportedCurrencyCode;
  goldRates?: Partial<GoldRates>;
  fiatFractionDigits?: number;
  izeFractionDigits?: number;
}

export function formatPrice({
  izeAmount,
  displayMode,
  currencyCode,
  goldRates,
  fiatFractionDigits = 2,
  izeFractionDigits = IZE_DECIMALS,
}: FormatPriceParams): string {
  if (displayMode === 'ize') {
    return formatIzeAmount(izeAmount, izeFractionDigits);
  }

  const fiatValue = toFiat(izeAmount, currencyCode, goldRates);
  const fiatFormatted = formatFiatAmount(fiatValue, currencyCode, fiatFractionDigits);

  if (displayMode === 'fiat') {
    return fiatFormatted;
  }

  return `${formatIzeAmount(izeAmount, izeFractionDigits)} · ${fiatFormatted}`;
}
