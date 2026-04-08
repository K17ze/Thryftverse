import AsyncStorage from '@react-native-async-storage/async-storage';

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
    const raw = await AsyncStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY);
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
  await AsyncStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export async function clearStoredAuthSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
}
