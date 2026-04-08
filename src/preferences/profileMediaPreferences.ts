import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_MEDIA_STORAGE_KEY = 'thryftverse:profile-media:v1';

type StoredProfileMediaRecord = {
  avatar: string | null;
  cover: string | null;
};

export type StoredProfileMedia = StoredProfileMediaRecord & {
  byUserId: Record<string, StoredProfileMediaRecord>;
};

const DEFAULT_PROFILE_MEDIA_RECORD: StoredProfileMediaRecord = {
  avatar: null,
  cover: null,
};

const DEFAULT_PROFILE_MEDIA: StoredProfileMedia = {
  avatar: null,
  cover: null,
  byUserId: {},
};

function normalizeUri(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProfileRecord(candidate: unknown): StoredProfileMediaRecord {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return DEFAULT_PROFILE_MEDIA_RECORD;
  }

  const parsed = candidate as Partial<StoredProfileMediaRecord>;
  return {
    avatar: normalizeUri(parsed.avatar),
    cover: normalizeUri(parsed.cover),
  };
}

function normalizeByUserIdMap(candidate: unknown): Record<string, StoredProfileMediaRecord> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {};
  }

  const rawMap = candidate as Record<string, unknown>;
  const next: Record<string, StoredProfileMediaRecord> = {};

  Object.keys(rawMap).forEach((key) => {
    const normalizedKey = normalizeUserId(key);
    if (!normalizedKey) {
      return;
    }

    next[normalizedKey] = normalizeProfileRecord(rawMap[key]);
  });

  return next;
}

function parseProfileMedia(raw: string | null): StoredProfileMedia {
  if (!raw) {
    return DEFAULT_PROFILE_MEDIA;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProfileMedia>;
    return {
      avatar: normalizeUri(parsed.avatar),
      cover: normalizeUri(parsed.cover),
      byUserId: normalizeByUserIdMap(parsed.byUserId),
    };
  } catch {
    return DEFAULT_PROFILE_MEDIA;
  }
}

async function writeProfileMedia(next: StoredProfileMedia) {
  await AsyncStorage.setItem(PROFILE_MEDIA_STORAGE_KEY, JSON.stringify(next));
}

export async function getStoredProfileMedia(): Promise<StoredProfileMedia> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_MEDIA_STORAGE_KEY);
    return parseProfileMedia(raw);
  } catch {
    return DEFAULT_PROFILE_MEDIA;
  }
}

export async function setStoredUserAvatarForUser(userId: string, uri: string): Promise<void> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }

  const current = await getStoredProfileMedia();
  const existing = current.byUserId[normalizedUserId] ?? DEFAULT_PROFILE_MEDIA_RECORD;

  await writeProfileMedia({
    ...current,
    byUserId: {
      ...current.byUserId,
      [normalizedUserId]: {
        ...existing,
        avatar: normalizeUri(uri),
      },
    },
  });
}

export async function setStoredUserCoverForUser(userId: string, uri: string): Promise<void> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }

  const current = await getStoredProfileMedia();
  const existing = current.byUserId[normalizedUserId] ?? DEFAULT_PROFILE_MEDIA_RECORD;

  await writeProfileMedia({
    ...current,
    byUserId: {
      ...current.byUserId,
      [normalizedUserId]: {
        ...existing,
        cover: normalizeUri(uri),
      },
    },
  });
}

export async function setStoredUserAvatar(uri: string): Promise<void> {
  const current = await getStoredProfileMedia();
  await writeProfileMedia({
    ...current,
    avatar: normalizeUri(uri),
  });
}

export async function setStoredUserCover(uri: string): Promise<void> {
  const current = await getStoredProfileMedia();
  await writeProfileMedia({
    ...current,
    cover: normalizeUri(uri),
  });
}
