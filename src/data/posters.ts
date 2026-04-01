import { MOCK_LISTINGS, MOCK_USERS, User } from './mockData';

export interface Poster {
  id: string;
  uploaderId: string;
  listingId: string;
  image: string;
  caption: string;
  createdAt: string;
  expiryHours: number;
  sharedFromUserId?: string;
}

export interface PosterViewModel extends Poster {
  createdAtMs: number;
  expiresAtMs: number;
  remainingHours: number;
  uploader?: User;
  sharedFrom?: User;
}

const NOW_TS = Date.now();

export const MOCK_POSTERS: Poster[] = [
  {
    id: 'p1',
    uploaderId: 'u1',
    listingId: 'l1',
    image: MOCK_LISTINGS[0]?.images[0] ?? 'https://picsum.photos/seed/poster1/400/500',
    caption: 'Fresh drop: YSL knit in very good condition',
    createdAt: new Date(NOW_TS - 20 * 60 * 1000).toISOString(),
    expiryHours: 24,
  },
  {
    id: 'p2',
    uploaderId: 'u2',
    listingId: 'l5',
    image: MOCK_LISTINGS[4]?.images[0] ?? 'https://picsum.photos/seed/poster2/400/500',
    caption: 'Off-White hoodie deal, size XL',
    createdAt: new Date(NOW_TS - 55 * 60 * 1000).toISOString(),
    expiryHours: 18,
  },
  {
    id: 'p3',
    uploaderId: 'u1',
    listingId: 'l6',
    image: MOCK_LISTINGS[5]?.images[0] ?? 'https://picsum.photos/seed/poster3/400/500',
    caption: 'Sharing this sneaker ad from my friend',
    createdAt: new Date(NOW_TS - 95 * 60 * 1000).toISOString(),
    expiryHours: 12,
    sharedFromUserId: 'u3',
  },
  {
    id: 'p4',
    uploaderId: 'u4',
    listingId: 'l7',
    image: MOCK_LISTINGS[6]?.images[0] ?? 'https://picsum.photos/seed/poster4/400/500',
    caption: 'New with tags cargo trousers',
    createdAt: new Date(NOW_TS - 3.5 * 60 * 60 * 1000).toISOString(),
    expiryHours: 10,
  },
  {
    id: 'p_expired',
    uploaderId: 'u3',
    listingId: 'l3',
    image: MOCK_LISTINGS[2]?.images[0] ?? 'https://picsum.photos/seed/poster5/400/500',
    caption: 'This one is expired and should be hidden',
    createdAt: new Date(NOW_TS - 30 * 60 * 60 * 1000).toISOString(),
    expiryHours: 24,
  },
];

export function getFreshPosters(
  now = Date.now(),
  freshnessHours = 24,
  runtimePosters: Poster[] = []
): PosterViewModel[] {
  const freshnessWindowMs = freshnessHours * 60 * 60 * 1000;

  return [...runtimePosters, ...MOCK_POSTERS]
    .map((poster) => {
      const createdAtMs = new Date(poster.createdAt).getTime();
      const expiresAtMs = createdAtMs + poster.expiryHours * 60 * 60 * 1000;
      const uploader = MOCK_USERS.find((user) => user.id === poster.uploaderId);
      const sharedFrom = poster.sharedFromUserId
        ? MOCK_USERS.find((user) => user.id === poster.sharedFromUserId)
        : undefined;
      const remainingHours = Math.max(1, Math.ceil((expiresAtMs - now) / (60 * 60 * 1000)));

      return {
        ...poster,
        createdAtMs,
        expiresAtMs,
        remainingHours,
        uploader,
        sharedFrom,
      };
    })
    .filter((poster) => poster.expiresAtMs > now && now - poster.createdAtMs <= freshnessWindowMs)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}
