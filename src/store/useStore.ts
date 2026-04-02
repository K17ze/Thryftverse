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

type BrowseSortOption = 'Recommended' | 'Newest' | 'Price: Low to High' | 'Price: High to Low';
type BrowseConditionOption = 'Any' | 'New with tags' | 'Very good' | 'Good' | 'Satisfactory';

interface BrowseFilterState {
  query: string;
  sort: BrowseSortOption;
  brands: string[];
  sizes: string[];
  condition: BrowseConditionOption;
}

interface SavedAddress {
  name: string;
  street: string;
  city: string;
  postcode: string;
}

interface SavedPaymentMethod {
  type: 'card' | 'bank_account';
  label: string;
  details?: string;
}

interface SyndicateComplianceProfile {
  countryCode: string;
  kycVerified: boolean;
  riskDisclosureAccepted: boolean;
  stableCoinWalletConnected: boolean;
}

type SyndicateEligibilityResult = {
  ok: boolean;
  message?: string;
};

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
  unitPriceGBP: number;
  unitPriceStable: number;
  marketMovePct24h: number;
  referencePriceGBP: number;
  avgEntryPriceGBP: number;
  realizedProfitGBP: number;
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

const RESTRICTED_SYNDICATE_COUNTRIES = ['US', 'CA'];

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
  syndicateCompliance: SyndicateComplianceProfile;
  updateSyndicateCompliance: (updates: Partial<SyndicateComplianceProfile>) => void;
  checkSyndicateEligibility: (settlementMode?: 'GBP' | 'TVUSD' | 'HYBRID') => SyndicateEligibilityResult;
  buySyndicateUnits: (asset: SyndicateAsset, buyerId: string, units: number) => TradeActionResult;
  sellSyndicateUnits: (asset: SyndicateAsset, sellerId: string, units: number) => TradeActionResult;
  marketLedger: MarketLedgerEntry[];

  // Browse filters/search
  browseFilters: BrowseFilterState;
  updateBrowseFilters: (updates: Partial<BrowseFilterState>) => void;
  resetBrowseFilters: () => void;

  // Checkout state
  savedAddress: SavedAddress | null;
  saveAddress: (address: SavedAddress) => void;
  clearSavedAddress: () => void;
  savedPaymentMethod: SavedPaymentMethod | null;
  savePaymentMethod: (paymentMethod: SavedPaymentMethod) => void;
  clearSavedPaymentMethod: () => void;

  // Account security
  twoFactorEnabled: boolean;
  setTwoFactorEnabled: (enabled: boolean) => void;

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
  syndicateCompliance: {
    countryCode: 'GB',
    kycVerified: false,
    riskDisclosureAccepted: false,
    stableCoinWalletConnected: false,
  },
  updateSyndicateCompliance: (updates) =>
    set((state) => ({
      syndicateCompliance: {
        ...state.syndicateCompliance,
        ...updates,
      },
    })),
  checkSyndicateEligibility: (settlementMode = 'HYBRID') => {
    const profile = get().syndicateCompliance;

    if (RESTRICTED_SYNDICATE_COUNTRIES.includes(profile.countryCode.toUpperCase())) {
      return {
        ok: false,
        message: 'Syndicate trading is currently unavailable in your selected country.',
      };
    }

    if (!profile.kycVerified) {
      return {
        ok: false,
        message: 'Complete KYC verification to access Syndicate markets.',
      };
    }

    if (!profile.riskDisclosureAccepted) {
      return {
        ok: false,
        message: 'Accept the risk disclosure before trading syndicate units.',
      };
    }

    if ((settlementMode === 'TVUSD' || settlementMode === 'HYBRID') && !profile.stableCoinWalletConnected) {
      return {
        ok: false,
        message: 'Connect your TVUSD wallet to trade this settlement mode.',
      };
    }

    return { ok: true };
  },
  buySyndicateUnits: (asset, buyerId, units) => {
    if (!asset.isOpen) {
      return { ok: false, message: 'Pool currently closed' };
    }

    const eligibility = get().checkSyndicateEligibility(asset.settlementMode);
    if (!eligibility.ok) {
      return { ok: false, message: eligibility.message };
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
      unitPriceGBP: asset.unitPriceGBP,
      unitPriceStable: asset.unitPriceStable,
      marketMovePct24h: asset.marketMovePct24h,
      referencePriceGBP: asset.unitPriceGBP,
      avgEntryPriceGBP: asset.avgEntryPriceGBP ?? asset.unitPriceGBP,
      realizedProfitGBP: asset.realizedProfitGBP ?? 0,
    };

    if (runtime.availableUnits < requestedUnits) {
      return { ok: false, message: 'Not enough units available' };
    }

    const totalUnits = Math.max(1, asset.totalUnits);
    const executionPriceGBP = runtime.unitPriceGBP;
    const executionPriceStable = runtime.unitPriceStable;
    const totalSpend = requestedUnits * executionPriceGBP;
    const nextYourUnits = runtime.yourUnits + requestedUnits;
    const nextAvgEntry =
      nextYourUnits > 0
        ? (runtime.avgEntryPriceGBP * runtime.yourUnits + executionPriceGBP * requestedUnits) / nextYourUnits
        : executionPriceGBP;

    const impactPct = Math.min(0.15, (requestedUnits / totalUnits) * 0.14);
    const nextUnitPriceGBP = Number((runtime.unitPriceGBP * (1 + impactPct)).toFixed(2));
    const stableRate = runtime.unitPriceGBP > 0
      ? runtime.unitPriceStable / runtime.unitPriceGBP
      : executionPriceStable / Math.max(executionPriceGBP, 0.01);
    const nextUnitPriceStable = Number((nextUnitPriceGBP * stableRate).toFixed(2));
    const referencePrice = Math.max(0.01, runtime.referencePriceGBP);
    const nextMarketMovePct24h = Number(
      (((nextUnitPriceGBP - referencePrice) / referencePrice) * 100).toFixed(1)
    );

    const nextRuntime: SyndicateRuntimeState = {
      availableUnits: runtime.availableUnits - requestedUnits,
      holders: runtime.yourUnits > 0 ? runtime.holders : runtime.holders + 1,
      volume24hGBP: runtime.volume24hGBP + totalSpend,
      yourUnits: nextYourUnits,
      unitPriceGBP: nextUnitPriceGBP,
      unitPriceStable: nextUnitPriceStable,
      marketMovePct24h: nextMarketMovePct24h,
      referencePriceGBP: referencePrice,
      avgEntryPriceGBP: nextAvgEntry,
      realizedProfitGBP: runtime.realizedProfitGBP,
    };

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
          note: `${buyerId} bought at £${executionPriceGBP.toFixed(2)} per unit`,
        }),
        ...state.marketLedger,
      ],
    });

    return {
      ok: true,
      message: `Purchased ${requestedUnits} unit${requestedUnits === 1 ? '' : 's'}`,
    };
  },
  sellSyndicateUnits: (asset, sellerId, units) => {
    if (!asset.isOpen) {
      return { ok: false, message: 'Pool currently closed' };
    }

    const eligibility = get().checkSyndicateEligibility(asset.settlementMode);
    if (!eligibility.ok) {
      return { ok: false, message: eligibility.message };
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
      unitPriceGBP: asset.unitPriceGBP,
      unitPriceStable: asset.unitPriceStable,
      marketMovePct24h: asset.marketMovePct24h,
      referencePriceGBP: asset.unitPriceGBP,
      avgEntryPriceGBP: asset.avgEntryPriceGBP ?? asset.unitPriceGBP,
      realizedProfitGBP: asset.realizedProfitGBP ?? 0,
    };

    if (runtime.yourUnits < requestedUnits) {
      return { ok: false, message: 'Not enough units in holdings' };
    }

    const totalUnits = Math.max(1, asset.totalUnits);
    const executionPriceGBP = runtime.unitPriceGBP;
    const totalReceive = requestedUnits * executionPriceGBP;
    const realizedDelta = (executionPriceGBP - runtime.avgEntryPriceGBP) * requestedUnits;

    const nextYourUnits = runtime.yourUnits - requestedUnits;
    const impactPct = Math.min(0.12, (requestedUnits / totalUnits) * 0.12);
    const nextUnitPriceGBP = Number(Math.max(0.05, runtime.unitPriceGBP * (1 - impactPct)).toFixed(2));
    const stableRate = runtime.unitPriceGBP > 0
      ? runtime.unitPriceStable / runtime.unitPriceGBP
      : asset.unitPriceStable / Math.max(asset.unitPriceGBP, 0.01);
    const nextUnitPriceStable = Number((nextUnitPriceGBP * stableRate).toFixed(2));
    const referencePrice = Math.max(0.01, runtime.referencePriceGBP);
    const nextMarketMovePct24h = Number(
      (((nextUnitPriceGBP - referencePrice) / referencePrice) * 100).toFixed(1)
    );

    const nextRuntime: SyndicateRuntimeState = {
      availableUnits: runtime.availableUnits + requestedUnits,
      holders: nextYourUnits === 0 ? Math.max(0, runtime.holders - 1) : runtime.holders,
      volume24hGBP: runtime.volume24hGBP + totalReceive,
      yourUnits: nextYourUnits,
      unitPriceGBP: nextUnitPriceGBP,
      unitPriceStable: nextUnitPriceStable,
      marketMovePct24h: nextMarketMovePct24h,
      referencePriceGBP: referencePrice,
      avgEntryPriceGBP: nextYourUnits > 0 ? runtime.avgEntryPriceGBP : nextUnitPriceGBP,
      realizedProfitGBP: runtime.realizedProfitGBP + realizedDelta,
    };

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
          note: `${sellerId} sold at £${executionPriceGBP.toFixed(2)} · realized £${realizedDelta.toFixed(2)}`,
        }),
        ...state.marketLedger,
      ],
    });

    return {
      ok: true,
      message: `Sold ${requestedUnits} unit${requestedUnits === 1 ? '' : 's'} · realized £${realizedDelta.toFixed(2)}`,
    };
  },
  marketLedger: [],

  browseFilters: {
    query: '',
    sort: 'Recommended',
    brands: [],
    sizes: [],
    condition: 'Any',
  },
  updateBrowseFilters: (updates) =>
    set((state) => ({
      browseFilters: {
        ...state.browseFilters,
        ...updates,
      },
    })),
  resetBrowseFilters: () =>
    set({
      browseFilters: {
        query: '',
        sort: 'Recommended',
        brands: [],
        sizes: [],
        condition: 'Any',
      },
    }),

  savedAddress: null,
  saveAddress: (address) => set({ savedAddress: address }),
  clearSavedAddress: () => set({ savedAddress: null }),
  savedPaymentMethod: null,
  savePaymentMethod: (paymentMethod) => set({ savedPaymentMethod: paymentMethod }),
  clearSavedPaymentMethod: () => set({ savedPaymentMethod: null }),

  twoFactorEnabled: false,
  setTwoFactorEnabled: (enabled) => set({ twoFactorEnabled: enabled }),

  notificationCount: 3, // Hardcoded initial mock badge
  setNotificationCount: (count) => set({ notificationCount: count }),

  sellDraft: {},
  updateSellDraft: (updates) =>
    set((state) => ({ sellDraft: { ...state.sellDraft, ...updates } })),
  clearSellDraft: () => set({ sellDraft: {} }),
}));
