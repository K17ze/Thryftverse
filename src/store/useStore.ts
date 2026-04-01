import { create } from 'zustand';
import type { Poster } from '../data/posters';
import type { AuctionMarketItem, AuctionViewModel, SyndicateAsset } from '../data/tradeHub';

interface User {
  id: string;
  username: string;
  avatar: string;
}

interface DraftListing {
  categoryId?: string;
  subcategoryId?: string;
  brand?: string;
  size?: string;
  condition?: string;
}

type TradeActionResult = {
  ok: boolean;
  message?: string;
};

interface AuctionRuntimeState {
  currentBid: number;
  bidCount: number;
  lastBidderId?: string;
  winnerUserId?: string;
  closedAtMs?: number;
  closedReason?: 'buy-now' | 'expired';
  settled?: boolean;
}

interface SyndicateRuntimeState {
  availableUnits: number;
  holders: number;
  volume24hGBP: number;
  yourUnits: number;
}

interface MarketLedgerEntry {
  id: string;
  timestamp: string;
  channel: 'auction' | 'syndicate';
  action: 'bid' | 'win' | 'buy-units' | 'sell-units';
  referenceId: string;
  amountGBP: number;
  units?: number;
  note?: string;
}

const makeLedgerEntry = (
  entry: Omit<MarketLedgerEntry, 'id' | 'timestamp'>
): MarketLedgerEntry => ({
  ...entry,
  id: `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
});

interface StoreState {
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;

  // Global Interactions
  wishlist: string[]; // array of string item IDs
  toggleWishlist: (id: string) => void;
  isWishlisted: (id: string) => boolean;
  seenPosterIds: string[];
  markPosterSeen: (posterId: string) => void;
  hasSeenPoster: (posterId: string) => boolean;
  customPosters: Poster[];
  addPoster: (poster: Poster) => void;
  removePoster: (posterId: string) => void;
  customAuctions: AuctionMarketItem[];
  addAuction: (auction: AuctionMarketItem) => void;
  auctionRuntime: Record<string, AuctionRuntimeState>;
  placeAuctionBid: (auction: AuctionViewModel, bidderId: string, amount: number) => TradeActionResult;
  buyNowAuction: (auction: AuctionViewModel, buyerId: string) => TradeActionResult;
  settleExpiredAuctions: (auctions: AuctionViewModel[]) => void;
  customSyndicates: SyndicateAsset[];
  addSyndicate: (asset: SyndicateAsset) => void;
  syndicateRuntime: Record<string, SyndicateRuntimeState>;
  buySyndicateUnits: (asset: SyndicateAsset, buyerId: string, units: number) => TradeActionResult;
  sellSyndicateUnits: (asset: SyndicateAsset, sellerId: string, units: number) => TradeActionResult;
  marketLedger: MarketLedgerEntry[];

  // Notifications
  notificationCount: number;
  setNotificationCount: (count: number) => void;

  // Selling Draft
  sellDraft: DraftListing;
  updateSellDraft: (updates: Partial<DraftListing>) => void;
  clearSellDraft: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  currentUser: null, // Note: For a real app, load this from secure storage initially
  isAuthenticated: false,
  login: (user) => set({ currentUser: user, isAuthenticated: true }),
  logout: () => set({ currentUser: null, isAuthenticated: false }),

  wishlist: [],
  toggleWishlist: (id) =>
    set((state) => {
      const isFav = state.wishlist.includes(id);
      return {
        wishlist: isFav
          ? state.wishlist.filter((fid) => fid !== id)
          : [...state.wishlist, id],
      };
    }),
  isWishlisted: (id) => get().wishlist.includes(id),
  seenPosterIds: [],
  markPosterSeen: (posterId) =>
    set((state) => {
      if (state.seenPosterIds.includes(posterId)) {
        return state;
      }

      return {
        seenPosterIds: [...state.seenPosterIds, posterId],
      };
    }),
  hasSeenPoster: (posterId) => get().seenPosterIds.includes(posterId),
  customPosters: [],
  addPoster: (poster) =>
    set((state) => ({
      customPosters: [poster, ...state.customPosters],
    })),
  removePoster: (posterId) =>
    set((state) => ({
      customPosters: state.customPosters.filter((poster) => poster.id !== posterId),
    })),
  customAuctions: [],
  addAuction: (auction) =>
    set((state) => ({
      customAuctions: [auction, ...state.customAuctions],
    })),
  auctionRuntime: {},
  placeAuctionBid: (auction, bidderId, amount) => {
    if (auction.lifecycle !== 'live' || auction.msToEnd <= 0) {
      return { ok: false, message: 'Auction is not live' };
    }

    const state = get();
    const runtime = state.auctionRuntime[auction.id];

    if (runtime?.closedAtMs) {
      return { ok: false, message: 'Auction already closed' };
    }

    const currentBid = runtime?.currentBid ?? auction.currentBid;
    if (amount <= currentBid) {
      return { ok: false, message: 'Bid must be above current bid' };
    }

    const nextRuntime: AuctionRuntimeState = {
      currentBid: amount,
      bidCount: (runtime?.bidCount ?? auction.bidCount) + 1,
      lastBidderId: bidderId,
      winnerUserId: runtime?.winnerUserId,
      settled: false,
    };

    set({
      auctionRuntime: {
        ...state.auctionRuntime,
        [auction.id]: nextRuntime,
      },
      marketLedger: [
        makeLedgerEntry({
          channel: 'auction',
          action: 'bid',
          referenceId: auction.id,
          amountGBP: amount,
          note: `Bid placed by ${bidderId}`,
        }),
        ...state.marketLedger,
      ],
    });

    return { ok: true, message: 'Bid placed' };
  },
  buyNowAuction: (auction, buyerId) => {
    if (!auction.buyNowPrice) {
      return { ok: false, message: 'Buy now not available' };
    }

    const state = get();
    const runtime = state.auctionRuntime[auction.id];

    if (runtime?.closedAtMs || auction.lifecycle === 'ended') {
      return { ok: false, message: 'Auction already closed' };
    }

    const closeTs = Date.now();
    const nextRuntime: AuctionRuntimeState = {
      currentBid: auction.buyNowPrice,
      bidCount: runtime?.bidCount ?? auction.bidCount,
      lastBidderId: buyerId,
      winnerUserId: buyerId,
      closedAtMs: closeTs,
      closedReason: 'buy-now',
      settled: true,
    };

    set({
      auctionRuntime: {
        ...state.auctionRuntime,
        [auction.id]: nextRuntime,
      },
      marketLedger: [
        makeLedgerEntry({
          channel: 'auction',
          action: 'win',
          referenceId: auction.id,
          amountGBP: auction.buyNowPrice,
          note: `Buy now by ${buyerId}`,
        }),
        ...state.marketLedger,
      ],
    });

    return { ok: true, message: 'Buy now completed' };
  },
  settleExpiredAuctions: (auctions) =>
    set((state) => {
      let changed = false;
      const nextRuntime = { ...state.auctionRuntime };
      const nextLedger = [...state.marketLedger];

      for (const auction of auctions) {
        if (auction.lifecycle !== 'ended') {
          continue;
        }

        const runtime = nextRuntime[auction.id];
        if (!runtime || runtime.settled) {
          continue;
        }

        changed = true;
        const winnerUserId = runtime.winnerUserId ?? runtime.lastBidderId;

        nextRuntime[auction.id] = {
          ...runtime,
          winnerUserId,
          closedAtMs: runtime.closedAtMs ?? Date.now(),
          closedReason: runtime.closedReason ?? 'expired',
          settled: true,
        };

        if (winnerUserId) {
          nextLedger.unshift(
            makeLedgerEntry({
              channel: 'auction',
              action: 'win',
              referenceId: auction.id,
              amountGBP: runtime.currentBid,
              note: `Auction settled for ${winnerUserId}`,
            })
          );
        }
      }

      if (!changed) {
        return state;
      }

      return {
        auctionRuntime: nextRuntime,
        marketLedger: nextLedger,
      };
    }),
  customSyndicates: [],
  addSyndicate: (asset) =>
    set((state) => ({
      customSyndicates: [asset, ...state.customSyndicates],
    })),
  syndicateRuntime: {},
  buySyndicateUnits: (asset, buyerId, units) => {
    if (!asset.isOpen) {
      return { ok: false, message: 'Pool currently closed' };
    }

    const requestedUnits = Math.floor(units);
    if (!Number.isFinite(requestedUnits) || requestedUnits <= 0) {
      return { ok: false, message: 'Units must be at least 1' };
    }

    const state = get();
    const runtime = state.syndicateRuntime[asset.id] ?? {
      availableUnits: asset.availableUnits,
      holders: asset.holders,
      volume24hGBP: asset.volume24hGBP,
      yourUnits: asset.yourUnits,
    };

    if (runtime.availableUnits < requestedUnits) {
      return { ok: false, message: 'Not enough units available' };
    }

    const nextRuntime: SyndicateRuntimeState = {
      availableUnits: runtime.availableUnits - requestedUnits,
      holders: runtime.yourUnits > 0 ? runtime.holders : runtime.holders + 1,
      volume24hGBP: runtime.volume24hGBP + requestedUnits * asset.unitPriceGBP,
      yourUnits: runtime.yourUnits + requestedUnits,
    };

    const totalSpend = requestedUnits * asset.unitPriceGBP;

    set({
      syndicateRuntime: {
        ...state.syndicateRuntime,
        [asset.id]: nextRuntime,
      },
      marketLedger: [
        makeLedgerEntry({
          channel: 'syndicate',
          action: 'buy-units',
          referenceId: asset.id,
          amountGBP: totalSpend,
          units: requestedUnits,
          note: `${buyerId} bought units`,
        }),
        ...state.marketLedger,
      ],
    });

    return { ok: true, message: 'Units purchased' };
  },
  sellSyndicateUnits: (asset, sellerId, units) => {
    if (!asset.isOpen) {
      return { ok: false, message: 'Pool currently closed' };
    }

    const requestedUnits = Math.floor(units);
    if (!Number.isFinite(requestedUnits) || requestedUnits <= 0) {
      return { ok: false, message: 'Units must be at least 1' };
    }

    const state = get();
    const runtime = state.syndicateRuntime[asset.id] ?? {
      availableUnits: asset.availableUnits,
      holders: asset.holders,
      volume24hGBP: asset.volume24hGBP,
      yourUnits: asset.yourUnits,
    };

    if (runtime.yourUnits < requestedUnits) {
      return { ok: false, message: 'Not enough units in holdings' };
    }

    const nextYourUnits = runtime.yourUnits - requestedUnits;
    const nextRuntime: SyndicateRuntimeState = {
      availableUnits: runtime.availableUnits + requestedUnits,
      holders: nextYourUnits === 0 ? Math.max(0, runtime.holders - 1) : runtime.holders,
      volume24hGBP: runtime.volume24hGBP + requestedUnits * asset.unitPriceGBP,
      yourUnits: nextYourUnits,
    };

    const totalReceive = requestedUnits * asset.unitPriceGBP;

    set({
      syndicateRuntime: {
        ...state.syndicateRuntime,
        [asset.id]: nextRuntime,
      },
      marketLedger: [
        makeLedgerEntry({
          channel: 'syndicate',
          action: 'sell-units',
          referenceId: asset.id,
          amountGBP: totalReceive,
          units: requestedUnits,
          note: `${sellerId} sold units`,
        }),
        ...state.marketLedger,
      ],
    });

    return { ok: true, message: 'Units sold' };
  },
  marketLedger: [],

  notificationCount: 3, // Hardcoded initial mock badge
  setNotificationCount: (count) => set({ notificationCount: count }),

  sellDraft: {},
  updateSellDraft: (updates) =>
    set((state) => ({ sellDraft: { ...state.sellDraft, ...updates } })),
  clearSellDraft: () => set({ sellDraft: {} }),
}));
