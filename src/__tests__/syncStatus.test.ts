import { describe, expect, it } from 'vitest';
import { getBackendSyncStatus } from '../utils/syncStatus';

describe('getBackendSyncStatus', () => {
  it('returns syncing status with highest precedence', () => {
    const status = getBackendSyncStatus({
      isSyncing: true,
      source: 'api',
      hasError: true,
    });

    expect(status).toEqual({
      tone: 'syncing',
      label: 'Refreshing',
    });
  });

  it('returns live status when data source is api and not syncing', () => {
    const status = getBackendSyncStatus({
      isSyncing: false,
      source: 'api',
      hasError: false,
    });

    expect(status).toEqual({
      tone: 'live',
      label: 'Live feed',
    });
  });

  it('returns offline error status for mock source with sync error', () => {
    const status = getBackendSyncStatus({
      isSyncing: false,
      source: 'mock',
      hasError: true,
    });

    expect(status).toEqual({
      tone: 'offline',
      label: 'Offline cache',
    });
  });

  it('returns offline fallback status for mock source without error', () => {
    const status = getBackendSyncStatus({
      isSyncing: false,
      source: 'mock',
      hasError: false,
    });

    expect(status).toEqual({
      tone: 'offline',
      label: 'Cached mode',
    });
  });

  it('uses provided custom labels', () => {
    const status = getBackendSyncStatus({
      isSyncing: false,
      source: 'mock',
      hasError: true,
      labels: {
        error: 'Reconnecting',
      },
    });

    expect(status).toEqual({
      tone: 'offline',
      label: 'Reconnecting',
    });
  });
});
