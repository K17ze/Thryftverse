import React from 'react';
import { SupportedCurrencyCode } from '../constants/currencies';
import { useCurrencyContext } from '../context/CurrencyContext';
import { CurrencyDisplayMode, formatPrice, toIze } from '../utils/currency';

interface FormatOptions {
  displayMode?: CurrencyDisplayMode;
  fiatFractionDigits?: number;
  izeFractionDigits?: number;
}

export function useFormattedPrice() {
  const { currencyCode, displayMode, goldRates } = useCurrencyContext();

  const formatFromIze = React.useCallback(
    (izeAmount: number, options: FormatOptions = {}) => {
      return formatPrice({
        izeAmount,
        displayMode: options.displayMode ?? displayMode,
        currencyCode,
        goldRates,
        fiatFractionDigits: options.fiatFractionDigits,
        izeFractionDigits: options.izeFractionDigits,
      });
    },
    [currencyCode, displayMode, goldRates]
  );

  const formatFromFiat = React.useCallback(
    (
      fiatAmount: number,
      sourceCurrency: SupportedCurrencyCode = 'GBP',
      options: FormatOptions = {}
    ) => {
      const izeAmount = toIze(fiatAmount, sourceCurrency, goldRates);
      return formatFromIze(izeAmount, options);
    },
    [formatFromIze, goldRates]
  );

  return {
    currencyCode,
    displayMode,
    formatFromIze,
    formatFromFiat,
  };
}
