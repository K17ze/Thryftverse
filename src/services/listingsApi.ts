import { Listing } from '../data/mockData';
import { fetchJson } from '../lib/apiClient';

interface ApiListingRow {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price_gbp: number;
  image_url?: string | null;
  created_at?: string;
}

interface ApiListingsResponse {
  items: ApiListingRow[];
}

export interface ListingsSyncResult {
  listings: Listing[];
  source: 'api' | 'mock';
  error?: string;
}

function deriveBrand(title: string) {
  const normalized = title.trim();
  if (!normalized) {
    return 'Thryftverse';
  }

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]} ${parts[1]}`;
}

function getFallbackImage(id: string) {
  return `https://picsum.photos/seed/${id}/800/800`;
}

function mapApiListingToApp(row: ApiListingRow, fallback?: Listing): Listing {
  const price = Number(row.price_gbp ?? fallback?.price ?? 0);
  const protectionFee = Number((price * 0.05 + 0.7).toFixed(2));
  const fallbackImages = (fallback?.images ?? []).filter((uri) => typeof uri === 'string' && uri.length > 0);
  const primaryImage = row.image_url?.trim();
  const resolvedImages = primaryImage
    ? [primaryImage, ...fallbackImages.filter((uri) => uri !== primaryImage)]
    : fallbackImages.length > 0
      ? fallbackImages
      : [getFallbackImage(row.id)];

  return {
    id: row.id,
    title: row.title || fallback?.title || 'Untitled listing',
    brand: fallback?.brand || deriveBrand(row.title),
    size: fallback?.size || 'One size',
    condition: fallback?.condition || 'Very good',
    price,
    priceWithProtection: Number((price + protectionFee).toFixed(2)),
    images: resolvedImages,
    likes: fallback?.likes ?? 0,
    isBumped: fallback?.isBumped,
    isSold: fallback?.isSold,
    sellerId: row.seller_id || fallback?.sellerId || 'u1',
    category: fallback?.category || 'women',
    subcategory: fallback?.subcategory || 'Clothing',
    description: row.description || fallback?.description || 'No description provided.',
    createdAt: row.created_at || fallback?.createdAt,
  };
}

export async function fetchListingsFromApiWithFallback(
  fallbackListings: Listing[]
): Promise<ListingsSyncResult> {
  const fallbackById = new Map(fallbackListings.map((listing) => [listing.id, listing]));

  try {
    const payload = await fetchJson<ApiListingsResponse>('/listings');
    const rows = Array.isArray(payload.items) ? payload.items : [];

    if (rows.length === 0) {
      return {
        listings: fallbackListings,
        source: 'mock',
        error: 'API returned zero listings; using mock fallback.',
      };
    }

    const mapped = rows.map((row) => mapApiListingToApp(row, fallbackById.get(row.id)));
    const mappedIds = new Set(mapped.map((listing) => listing.id));
    const merged = [...mapped, ...fallbackListings.filter((listing) => !mappedIds.has(listing.id))];

    return {
      listings: merged,
      source: 'api',
    };
  } catch (error) {
    return {
      listings: fallbackListings,
      source: 'mock',
      error: (error as Error).message,
    };
  }
}
