import { MOCK_LISTINGS, MOCK_USERS } from './mockData';
import { ENABLE_RUNTIME_MOCKS } from '../constants/runtimeFlags';

export type AuctionLifecycle = 'upcoming' | 'live' | 'ended';

export interface AuctionMarketItem {
  id: string;
  listingId: string;
  sellerId: string;
  title: string;
  image: string;
  startsAt: string;
  endsAt: string;
  startingBid: number;
  currentBid: number;
  bidCount: number;
  buyNowPrice?: number;
}

export interface AuctionViewModel extends AuctionMarketItem {
  lifecycle: AuctionLifecycle;
  msToStart: number;
  msToEnd: number;
  progress: number;
}

export interface SyndicateAsset {
  id: string;
  listingId: string;
  issuerId: string;
  title: string;
  image: string;
  totalUnits: number;
  availableUnits: number;
  unitPriceGBP: number;
  unitPriceStable: number;
  settlementMode: 'GBP' | 'TVUSD' | 'HYBRID';
  issuerJurisdiction?: string;
  marketMovePct24h: number;
  holders: number;
  volume24hGBP: number;
  yourUnits: number;
  avgEntryPriceGBP?: number;
  realizedProfitGBP?: number;
  isOpen: boolean;
}

const WINDOW_6_HOURS_MS = 6 * 60 * 60 * 1000;
const NOW_TS = Date.now();

const toIso = (timestampMs: number) => new Date(timestampMs).toISOString();

export const MOCK_AUCTIONS: AuctionMarketItem[] = [
  {
    id: 'a1',
    listingId: 'l1',
    sellerId: 'u1',
    title: 'YSL Knit Auction',
    image: MOCK_LISTINGS[0]?.images[0] ?? 'https://picsum.photos/seed/auction1/500/700',
    startsAt: toIso(NOW_TS - 90 * 60 * 1000),
    endsAt: toIso(NOW_TS - 90 * 60 * 1000 + WINDOW_6_HOURS_MS),
    startingBid: 120,
    currentBid: 196,
    bidCount: 23,
    buyNowPrice: 240,
  },
  {
    id: 'a2',
    listingId: 'l5',
    sellerId: 'u2',
    title: 'Off-White Hoodie Auction',
    image: MOCK_LISTINGS[4]?.images[0] ?? 'https://picsum.photos/seed/auction2/500/700',
    startsAt: toIso(NOW_TS - 3 * 60 * 60 * 1000),
    endsAt: toIso(NOW_TS - 3 * 60 * 60 * 1000 + WINDOW_6_HOURS_MS),
    startingBid: 95,
    currentBid: 174,
    bidCount: 18,
  },
  {
    id: 'a3',
    listingId: 'l8',
    sellerId: 'u4',
    title: 'Jacquemus Bag Premier Drop',
    image: MOCK_LISTINGS[7]?.images[0] ?? 'https://picsum.photos/seed/auction3/500/700',
    startsAt: toIso(NOW_TS + 40 * 60 * 1000),
    endsAt: toIso(NOW_TS + 40 * 60 * 1000 + WINDOW_6_HOURS_MS),
    startingBid: 300,
    currentBid: 300,
    bidCount: 0,
    buyNowPrice: 385,
  },
  {
    id: 'a4',
    listingId: 'l10',
    sellerId: 'u3',
    title: 'Vintage Chuck Lot Auction',
    image: MOCK_LISTINGS[9]?.images[0] ?? 'https://picsum.photos/seed/auction4/500/700',
    startsAt: toIso(NOW_TS + 2.5 * 60 * 60 * 1000),
    endsAt: toIso(NOW_TS + 2.5 * 60 * 60 * 1000 + WINDOW_6_HOURS_MS),
    startingBid: 70,
    currentBid: 70,
    bidCount: 0,
  },
  {
    id: 'a5',
    listingId: 'l3',
    sellerId: 'u3',
    title: 'RL Harrington Archive Auction',
    image: MOCK_LISTINGS[2]?.images[0] ?? 'https://picsum.photos/seed/auction5/500/700',
    startsAt: toIso(NOW_TS - 10 * 60 * 60 * 1000),
    endsAt: toIso(NOW_TS - 10 * 60 * 60 * 1000 + WINDOW_6_HOURS_MS),
    startingBid: 45,
    currentBid: 79,
    bidCount: 14,
  },
];

export const MOCK_SYNDICATE_ASSETS: SyndicateAsset[] = [
  {
    id: 's1',
    listingId: 'l2',
    issuerId: 'u2',
    title: 'AMI Shirt Fraction Pool',
    image: MOCK_LISTINGS[1]?.images[0] ?? 'https://picsum.photos/seed/synd1/500/700',
    totalUnits: 20,
    availableUnits: 8,
    unitPriceGBP: 1.52,
    unitPriceStable: 1.95,
    settlementMode: 'HYBRID',
    issuerJurisdiction: 'GB',
    marketMovePct24h: 6.4,
    holders: 9,
    volume24hGBP: 2140,
    yourUnits: 2,
    isOpen: true,
  },
  {
    id: 's2',
    listingId: 'l4',
    issuerId: 'u1',
    title: 'Stussy Tee Syndicate',
    image: MOCK_LISTINGS[3]?.images[0] ?? 'https://picsum.photos/seed/synd2/500/700',
    totalUnits: 20,
    availableUnits: 3,
    unitPriceGBP: 2.08,
    unitPriceStable: 2.66,
    settlementMode: 'TVUSD',
    issuerJurisdiction: 'EU',
    marketMovePct24h: -2.1,
    holders: 12,
    volume24hGBP: 3180,
    yourUnits: 0,
    isOpen: true,
  },
  {
    id: 's3',
    listingId: 'l6',
    issuerId: 'u3',
    title: 'Air Max 90 Split',
    image: MOCK_LISTINGS[5]?.images[0] ?? 'https://picsum.photos/seed/synd3/500/700',
    totalUnits: 20,
    availableUnits: 11,
    unitPriceGBP: 0.96,
    unitPriceStable: 1.23,
    settlementMode: 'GBP',
    issuerJurisdiction: 'GB',
    marketMovePct24h: 4.2,
    holders: 6,
    volume24hGBP: 1088,
    yourUnits: 4,
    isOpen: true,
  },
  {
    id: 's4',
    listingId: 'l9',
    issuerId: 'u3',
    title: 'Represent Hoodie Block',
    image: MOCK_LISTINGS[8]?.images[0] ?? 'https://picsum.photos/seed/synd4/500/700',
    totalUnits: 20,
    availableUnits: 0,
    unitPriceGBP: 2.74,
    unitPriceStable: 3.50,
    settlementMode: 'HYBRID',
    issuerJurisdiction: 'SG',
    marketMovePct24h: 11.8,
    holders: 13,
    volume24hGBP: 6220,
    yourUnits: 5,
    isOpen: false,
  },
];

export function getAuctionMarket(
  now = Date.now(),
  runtimeAuctions: AuctionMarketItem[] = []
): AuctionViewModel[] {
  const seedAuctions = ENABLE_RUNTIME_MOCKS ? MOCK_AUCTIONS : [];

  return [...runtimeAuctions, ...seedAuctions]
    .map((auction) => {
      const startsAtMs = new Date(auction.startsAt).getTime();
      const endsAtMs = new Date(auction.endsAt).getTime();
      const msToStart = startsAtMs - now;
      const msToEnd = endsAtMs - now;

      let lifecycle: AuctionLifecycle = 'upcoming';
      if (msToStart <= 0 && msToEnd > 0) {
        lifecycle = 'live';
      } else if (msToEnd <= 0) {
        lifecycle = 'ended';
      }

      const elapsedMs = Math.max(0, WINDOW_6_HOURS_MS - msToEnd);
      const progress = Math.min(1, Math.max(0, elapsedMs / WINDOW_6_HOURS_MS));

      return {
        ...auction,
        lifecycle,
        msToStart,
        msToEnd,
        progress,
      };
    })
    .sort((a, b) => {
      const lifecycleRank: Record<AuctionLifecycle, number> = {
        live: 0,
        upcoming: 1,
        ended: 2,
      };

      if (lifecycleRank[a.lifecycle] !== lifecycleRank[b.lifecycle]) {
        return lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle];
      }

      if (a.lifecycle === 'live') {
        return a.msToEnd - b.msToEnd;
      }

      if (a.lifecycle === 'upcoming') {
        return a.msToStart - b.msToStart;
      }

      return b.currentBid - a.currentBid;
    });
}

export function getSyndicateMarket(runtimeAssets: SyndicateAsset[] = []) {
  const seedAssets = ENABLE_RUNTIME_MOCKS ? MOCK_SYNDICATE_ASSETS : [];

  return [...runtimeAssets, ...seedAssets].sort(
    (a, b) => b.totalUnits * b.unitPriceGBP - a.totalUnits * a.unitPriceGBP
  );
}

export function getUserLabel(userId: string) {
  const user = MOCK_USERS.find((item) => item.id === userId);
  return user ? `@${user.username}` : '@seller';
}

export function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}

export function formatCompact(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return `${value}`;
}

export function formatCountdown(ms: number) {
  if (ms <= 0) {
    return '00:00:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}
