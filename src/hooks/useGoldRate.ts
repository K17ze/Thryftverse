import { useCurrencyContext } from '../context/CurrencyContext';

export function useGoldRate() {
  const { currencyCode, goldRates, rateUpdatedAt } = useCurrencyContext();

  return {
    currencyCode,
    goldRate: goldRates[currencyCode],
    goldRates,
    rateUpdatedAt,
  };
}
