import { useCurrencyContext } from '../context/CurrencyContext';

export function useGoldRate() {
  const { currencyCode, goldRates } = useCurrencyContext();

  return {
    currencyCode,
    goldRate: goldRates[currencyCode],
    goldRates,
  };
}
