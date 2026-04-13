/**
 * mockGate — Safely resolve mock data fallbacks.
 *
 * When `ENABLE_RUNTIME_MOCKS` is false (production), mock arrays and lookups
 * return empty/undefined instead of hardcoded demo data. This prevents mock
 * data from leaking into production builds while keeping the dev experience
 * smooth.
 */
import { ENABLE_RUNTIME_MOCKS } from '../constants/runtimeFlags';

/**
 * Returns the mock array if runtime mocks are enabled, otherwise [].
 */
export function mockArrayOrEmpty<T>(mockArray: T[]): T[] {
  return ENABLE_RUNTIME_MOCKS ? mockArray : [];
}

/**
 * Looks up an item in a mock array when runtime mocks are enabled.
 * Returns `undefined` in production even if a match exists.
 */
export function mockFind<T>(
  mockArray: T[],
  predicate: (item: T) => boolean,
): T | undefined {
  if (!ENABLE_RUNTIME_MOCKS) {
    return undefined;
  }

  return mockArray.find(predicate);
}

/**
 * Returns the fallback value if `primary` is undefined and runtime mocks
 * are enabled. In production, returns only the primary value.
 */
export function mockFallback<T>(primary: T | undefined | null, mockValue: T): T | undefined {
  if (primary !== undefined && primary !== null) {
    return primary;
  }

  return ENABLE_RUNTIME_MOCKS ? mockValue : undefined;
}
