import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  SupportedCurrencyCode,
} from '../constants/currencies';
import {
  CurrencyDisplayMode,
  DEFAULT_GOLD_RATES,
  GoldRates,
} from '../utils/currency';

interface CurrencyContextValue {
  currencyCode: SupportedCurrencyCode;
  displayMode: CurrencyDisplayMode;
  goldRates: GoldRates;
  rateUpdatedAt: number;
  setCurrencyCode: (code: SupportedCurrencyCode) => void;
  setDisplayMode: (mode: CurrencyDisplayMode) => void;
  cycleDisplayMode: () => void;
}

const CurrencyContext = React.createContext<CurrencyContextValue | undefined>(undefined);

const DISPLAY_MODE_SEQUENCE: CurrencyDisplayMode[] = ['both', 'fiat', 'ize'];
const CURRENCY_PREF_STORAGE_KEY = 'thryftverse:currency-pref:v1';

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currencyCode, setCurrencyCode] = React.useState<SupportedCurrencyCode>(DEFAULT_CURRENCY_CODE);
  const [displayMode, setDisplayMode] = React.useState<CurrencyDisplayMode>('both');
  const [goldRates, setGoldRates] = React.useState<GoldRates>(DEFAULT_GOLD_RATES);
  const [rateUpdatedAt, setRateUpdatedAt] = React.useState<number>(Date.now());
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;

    const loadSavedPreference = async () => {
      try {
        const raw = await AsyncStorage.getItem(CURRENCY_PREF_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as {
          currencyCode?: SupportedCurrencyCode;
          displayMode?: CurrencyDisplayMode;
        };

        if (parsed.currencyCode && parsed.currencyCode in CURRENCIES) {
          setCurrencyCode(parsed.currencyCode);
        }

        if (parsed.displayMode && DISPLAY_MODE_SEQUENCE.includes(parsed.displayMode)) {
          setDisplayMode(parsed.displayMode);
        }
      } catch {
        // Ignore persisted preference corruption and fall back to defaults.
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    loadSavedPreference();

    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!isHydrated) {
      return;
    }

    AsyncStorage.setItem(
      CURRENCY_PREF_STORAGE_KEY,
      JSON.stringify({
        currencyCode,
        displayMode,
      })
    ).catch(() => {
      // Best-effort persistence; UI should remain responsive even if storage fails.
    });
  }, [currencyCode, displayMode, isHydrated]);

  const cycleDisplayMode = React.useCallback(() => {
    setDisplayMode((current) => {
      const index = DISPLAY_MODE_SEQUENCE.indexOf(current);
      const nextIndex = (index + 1) % DISPLAY_MODE_SEQUENCE.length;
      return DISPLAY_MODE_SEQUENCE[nextIndex];
    });
  }, []);

  React.useEffect(() => {
    const interval = setInterval(() => {
      const driftSeed = Math.sin(Date.now() / 60000) * 0.0007;

      setGoldRates((current) => {
        const nextEntries = (Object.keys(current) as SupportedCurrencyCode[]).map((code) => {
          const base = DEFAULT_GOLD_RATES[code];
          const randomNudge = (Math.random() - 0.5) * 0.0016;
          const candidate = current[code] * (1 + driftSeed + randomNudge);
          const floor = base * 0.94;
          const ceil = base * 1.08;
          const clamped = Math.min(ceil, Math.max(floor, candidate));
          return [code, Number(clamped.toFixed(4))] as const;
        });

        return Object.fromEntries(nextEntries) as GoldRates;
      });

      setRateUpdatedAt(Date.now());
    }, 20000);

    return () => clearInterval(interval);
  }, []);

  const value = React.useMemo<CurrencyContextValue>(
    () => ({
      currencyCode,
      displayMode,
      goldRates,
      rateUpdatedAt,
      setCurrencyCode,
      setDisplayMode,
      cycleDisplayMode,
    }),
    [currencyCode, displayMode, goldRates, rateUpdatedAt, cycleDisplayMode]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrencyContext() {
  const context = React.useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrencyContext must be used within CurrencyProvider');
  }

  return context;
}
