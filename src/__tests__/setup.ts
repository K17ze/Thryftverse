import { vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  return {
    default: {
      setItem: vi.fn(() => Promise.resolve()),
      getItem: vi.fn(() => Promise.resolve(null)),
      removeItem: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
      getAllKeys: vi.fn(() => Promise.resolve([])),
      multiGet: vi.fn(() => Promise.resolve([])),
      multiSet: vi.fn(() => Promise.resolve()),
      multiRemove: vi.fn(() => Promise.resolve()),
    },
  };
});
