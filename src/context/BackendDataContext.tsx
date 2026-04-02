import React from 'react';
import { Listing, MOCK_LISTINGS } from '../data/mockData';
import { getApiBaseUrl } from '../lib/apiClient';
import { fetchListingsFromApiWithFallback } from '../services/listingsApi';

interface BackendDataContextValue {
  listings: Listing[];
  source: 'api' | 'mock';
  apiBaseUrl: string;
  isSyncing: boolean;
  lastError: string | null;
  refreshListings: () => Promise<void>;
}

const BackendDataContext = React.createContext<BackendDataContextValue | undefined>(undefined);

export function BackendDataProvider({ children }: { children: React.ReactNode }) {
  const [listings, setListings] = React.useState<Listing[]>(MOCK_LISTINGS);
  const [source, setSource] = React.useState<'api' | 'mock'>('mock');
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const apiBaseUrl = React.useMemo(() => getApiBaseUrl(), []);

  const refreshListings = React.useCallback(async () => {
    setIsSyncing(true);
    const result = await fetchListingsFromApiWithFallback(MOCK_LISTINGS);
    setListings(result.listings);
    setSource(result.source);
    setLastError(result.error ?? null);
    setIsSyncing(false);
  }, []);

  React.useEffect(() => {
    void refreshListings();
  }, [refreshListings]);

  const value = React.useMemo<BackendDataContextValue>(
    () => ({
      listings,
      source,
      apiBaseUrl,
      isSyncing,
      lastError,
      refreshListings,
    }),
    [apiBaseUrl, isSyncing, lastError, listings, refreshListings, source]
  );

  return <BackendDataContext.Provider value={value}>{children}</BackendDataContext.Provider>;
}

export function useBackendData() {
  const context = React.useContext(BackendDataContext);
  if (!context) {
    throw new Error('useBackendData must be used within BackendDataProvider');
  }

  return context;
}
