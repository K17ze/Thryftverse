import { MOCK_USERS } from '../data/mockData';
import { fetchJson } from '../lib/apiClient';

export interface FeedLook {
  id: string;
  creator: { id: string; name: string; avatar: string; isVerified?: boolean };
  title: string;
  description: string;
  coverImage: string;
  items: { id: string; label: string }[];
  likes: number;
  comments: number;
  timeAgo: string;
}

interface RankedFeedLook extends FeedLook {
  rank: number;
}

interface FeedLooksApiResponse {
  items: RankedFeedLook[];
}

const FALLBACK_RANKED_LOOKS: RankedFeedLook[] = [
  {
    id: 'f1',
    rank: 1,
    creator: { id: 'u1', name: 'mariefullery', avatar: MOCK_USERS[0].avatar, isVerified: true },
    title: 'Winter Layers in the City',
    description: 'Mixing high and low, keeping it cozy.',
    coverImage: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80',
    items: [
      { id: 'l5', label: 'Off-White Hoodie' },
      { id: 'l7', label: 'Cargo Trousers' },
      { id: 'l6', label: 'Air Max 90' },
    ],
    likes: 245,
    comments: 18,
    timeAgo: '2h ago',
  },
  {
    id: 'f2',
    rank: 2,
    creator: { id: 'u2', name: 'scott_art', avatar: MOCK_USERS[1].avatar },
    title: 'Minimal Monochrome',
    description: 'Clean lines for the weekend.',
    coverImage: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80',
    items: [
      { id: 'l2', label: 'AMI Striped Shirt' },
      { id: 'l3', label: 'RL Harrington' },
    ],
    likes: 156,
    comments: 12,
    timeAgo: '5h ago',
  },
  {
    id: 'f3',
    rank: 3,
    creator: { id: 'u3', name: 'dankdunksuk', avatar: MOCK_USERS[2].avatar, isVerified: true },
    title: 'Streetwear Daily',
    description: 'Latest pickups. Those Chucks never get old.',
    coverImage: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80',
    items: [
      { id: 'l4', label: 'Stussy Logo Tee' },
      { id: 'l9', label: 'Represent Hoodie' },
      { id: 'l10', label: 'Chuck Taylor' },
    ],
    likes: 89,
    comments: 7,
    timeAgo: '1d ago',
  },
];

function toStableRankedLooks(items: RankedFeedLook[]) {
  return [...items].sort((a, b) => {
    const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;

    if (rankA === rankB) {
      return a.id.localeCompare(b.id);
    }

    return rankA - rankB;
  });
}

function stripRank(items: RankedFeedLook[]): FeedLook[] {
  return items.map(({ rank: _rank, ...look }) => look);
}

export const DEFAULT_FEED_LOOKS: FeedLook[] = stripRank(toStableRankedLooks(FALLBACK_RANKED_LOOKS));

export async function fetchFeedLooksWithFallback(): Promise<{
  looks: FeedLook[];
  source: 'api' | 'stub';
  error?: string;
}> {
  try {
    const payload = await fetchJson<FeedLooksApiResponse>('/feed/looks');
    const rows = Array.isArray(payload.items) ? payload.items : [];

    if (rows.length === 0) {
      return {
        looks: DEFAULT_FEED_LOOKS,
        source: 'stub',
        error: 'API returned zero feed looks; using stub fallback.',
      };
    }

    return {
      looks: stripRank(toStableRankedLooks(rows)),
      source: 'api',
    };
  } catch (error) {
    return {
      looks: DEFAULT_FEED_LOOKS,
      source: 'stub',
      error: (error as Error).message,
    };
  }
}
