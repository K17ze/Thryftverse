type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let asyncStorageCache: AsyncStorageLike | null | undefined;

async function getAsyncStorage(): Promise<AsyncStorageLike | null> {
  if (asyncStorageCache !== undefined) {
    return asyncStorageCache;
  }

  try {
    const module = await import('@react-native-async-storage/async-storage');
    if (!module) {
      asyncStorageCache = null;
      return null;
    }
    const resolved = (module as { default?: AsyncStorageLike }).default ?? module;
    if (resolved && typeof resolved.getItem === 'function') {
      asyncStorageCache = resolved as AsyncStorageLike;
      return asyncStorageCache;
    }
  } catch {
    // Ignore and fall back to null.
  }

  asyncStorageCache = null;
  return null;
}

const AUTH_SNAPSHOT_STORAGE_KEY = 'thryftverse:auth-snapshot:v1';

export interface StoredAuthSnapshotUser {
  id: string;
  username: string;
  avatar: string;
}

export interface StoredAuthSnapshot {
  user: StoredAuthSnapshotUser;
  twoFactorEnabled: boolean;
}

function isValidUser(value: unknown): value is StoredAuthSnapshotUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredAuthSnapshotUser>;
  return (
    typeof candidate.id === 'string' && candidate.id.trim().length > 0 &&
    typeof candidate.username === 'string' && candidate.username.trim().length > 0 &&
    typeof candidate.avatar === 'string' && candidate.avatar.trim().length > 0
  );
}

export async function getStoredAuthSnapshot(): Promise<StoredAuthSnapshot | null> {
  try {
    const asyncStorage = await getAsyncStorage();
    if (!asyncStorage) {
      return null;
    }

    const raw = await asyncStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredAuthSnapshot>;
    if (!isValidUser(parsed.user)) {
      return null;
    }

    return {
      user: parsed.user,
      twoFactorEnabled: Boolean(parsed.twoFactorEnabled),
    };
  } catch {
    return null;
  }
}

export async function setStoredAuthSnapshot(snapshot: StoredAuthSnapshot): Promise<void> {
  const asyncStorage = await getAsyncStorage();
  if (!asyncStorage) {
    return;
  }

  await asyncStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export async function clearStoredAuthSnapshot(): Promise<void> {
  const asyncStorage = await getAsyncStorage();
  if (!asyncStorage) {
    return;
  }

  await asyncStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
}
