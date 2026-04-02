import { CURRENCIES } from '../constants/currencies';
import { useCurrencyContext } from '../context/CurrencyContext';

const DISPLAY_LABELS = {
  both: '1ze + Local Fiat',
  fiat: 'Local Fiat Only',
  ize: '1ze Only',
} as const;

export function useCurrencyPref() {
  const {
    currencyCode,
    displayMode,
    setCurrencyCode,
    setDisplayMode,
    cycleDisplayMode,
  } = useCurrencyContext();

  return {
    currencyCode,
    displayMode,
    setCurrencyCode,
    setDisplayMode,
    cycleDisplayMode,
    displayModeLabel: DISPLAY_LABELS[displayMode],
    currencyLabel: `${CURRENCIES[currencyCode].name} (${currencyCode})`,
  };
}
