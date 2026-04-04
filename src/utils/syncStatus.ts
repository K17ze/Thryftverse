export type SyncStatusTone = 'live' | 'syncing' | 'offline';

export interface SyncStatus {
  tone: SyncStatusTone;
  label: string;
}

interface BackendSyncStatusInput {
  isSyncing: boolean;
  source: 'api' | 'mock';
  hasError: boolean;
  labels?: {
    syncing?: string;
    live?: string;
    error?: string;
    fallback?: string;
  };
}

const DEFAULT_LABELS = {
  syncing: 'Refreshing',
  live: 'Live feed',
  error: 'Offline cache',
  fallback: 'Cached mode',
};

export function getBackendSyncStatus({
  isSyncing,
  source,
  hasError,
  labels,
}: BackendSyncStatusInput): SyncStatus {
  const resolvedLabels = {
    ...DEFAULT_LABELS,
    ...labels,
  };

  if (isSyncing) {
    return {
      tone: 'syncing',
      label: resolvedLabels.syncing,
    };
  }

  if (source === 'api') {
    return {
      tone: 'live',
      label: resolvedLabels.live,
    };
  }

  if (hasError) {
    return {
      tone: 'offline',
      label: resolvedLabels.error,
    };
  }

  return {
    tone: 'offline',
    label: resolvedLabels.fallback,
  };
}
