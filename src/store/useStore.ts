import { create } from 'zustand';
import type { Poster } from '../data/posters';
import type { AuctionMarketItem, AuctionViewModel, SyndicateAsset } from '../data/tradeHub';
import type { ChatBot, Conversation, Message as ConversationMessage } from '../data/mockData';
import { MOCK_CHAT_BOTS, MOCK_CONVERSATIONS, MY_USER } from '../data/mockData';
import { ENABLE_RUNTIME_MOCKS } from '../constants/runtimeFlags';

interface User {
  id: string;
  username: string;
  avatar: string;
}

interface ProfileMediaOverride {
  avatar: string | null;
  cover: string | null;
}

interface DraftListing {
  categoryId?: string;
  subcategoryId?: string;
  brand?: string;
  size?: string;
  condition?: string;
}

interface CreateGroupConversationInput {
  title: string;
  memberIds: string[];
  creatorId?: string;
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
  id?: number;
  name: string;
  street: string;
  city: string;
  postcode: string;
  isDefault?: boolean;
}

interface SavedPaymentMethod {
  id?: number;
  type: 'card' | 'bank_account';
  label: string;
  details?: string;
  isDefault?: boolean;
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
  deliveryTriggered?: boolean;
  deliveryListingId?: string;
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

async function persistLocalAuthSnapshot(
  currentUser: User | null,
  twoFactorEnabled: boolean
) {
  try {
    const {
      clearStoredAuthSnapshot,
      setStoredAuthSnapshot,
    } = await import('../preferences/authSnapshot');

    if (!currentUser) {
      await clearStoredAuthSnapshot();
      return;
    }

    await setStoredAuthSnapshot({
      user: currentUser,
      twoFactorEnabled,
    });
  } catch {
    // Best-effort persistence should not block local state updates.
  }
}

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

  // Conversations Inbox
  conversations: Conversation[];
  availableChatBots: ChatBot[];
  upsertConversation: (conversation: Conversation) => void;
  markConversationRead: (id: string) => void;
  archiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  createGroupConversation: (input: CreateGroupConversationInput) => string;
  deployBotToConversation: (conversationId: string, botId: string) => void;
  undeployBotFromConversation: (conversationId: string, botId: string) => void;
  appendConversationMessage: (conversationId: string, message: ConversationMessage) => void;
  replaceConversationMessages: (conversationId: string, messages: ConversationMessage[]) => void;

  // Profile Uploads
  userAvatar: string | null;
  userCover: string | null;
  profileMediaOverrides: Record<string, ProfileMediaOverride>;
  hydrateProfileMediaOverrides: (overrides: Record<string, ProfileMediaOverride>) => void;
  setProfileMediaOverride: (userId: string, updates: Partial<ProfileMediaOverride>) => void;
  updateUserAvatar: (uri: string) => void;
  updateUserCover: (uri: string) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  currentUser: null, // Note: For a real app, load this from secure storage initially
  isAuthenticated: false,
  login: (user) => {
    set({ currentUser: user, isAuthenticated: true });
    persistLocalAuthSnapshot(user, get().twoFactorEnabled);
  },
  logout: () => {
    set({ currentUser: null, isAuthenticated: false, twoFactorEnabled: false });
    persistLocalAuthSnapshot(null, false);
  },

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
        message: 'Connect your 1ze wallet to trade this settlement mode.',
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
    const deliveryTriggered = nextRuntime.availableUnits === 0 && nextYourUnits >= totalUnits;

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
      message: deliveryTriggered
        ? `Purchased ${requestedUnits} unit${requestedUnits === 1 ? '' : 's'} · You now own 100% and delivery has been initiated`
        : `Purchased ${requestedUnits} unit${requestedUnits === 1 ? '' : 's'}`,
      deliveryTriggered,
      deliveryListingId: deliveryTriggered ? asset.listingId : undefined,
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
  setTwoFactorEnabled: (enabled) => {
    set({ twoFactorEnabled: enabled });
    persistLocalAuthSnapshot(get().currentUser, enabled);
  },

  notificationCount: ENABLE_RUNTIME_MOCKS ? 3 : 0,
  setNotificationCount: (count) => set({ notificationCount: count }),

  sellDraft: {},
  updateSellDraft: (updates) =>
    set((state) => ({ sellDraft: { ...state.sellDraft, ...updates } })),
  clearSellDraft: () => set({ sellDraft: {} }),

  conversations: ENABLE_RUNTIME_MOCKS ? MOCK_CONVERSATIONS : [],
  availableChatBots: ENABLE_RUNTIME_MOCKS ? MOCK_CHAT_BOTS : [],
  upsertConversation: (conversation) =>
    set((state) => {
      const existing = state.conversations.find((item) => item.id === conversation.id);
      if (!existing) {
        return {
          conversations: [conversation, ...state.conversations],
        };
      }

      const mergedConversation: Conversation = {
        ...existing,
        ...conversation,
        participantIds: conversation.participantIds ?? existing.participantIds,
        botIds: conversation.botIds ?? existing.botIds,
        messages: conversation.messages.length ? conversation.messages : existing.messages,
      };

      return {
        conversations: [
          mergedConversation,
          ...state.conversations.filter((item) => item.id !== conversation.id),
        ],
      };
    }),
  markConversationRead: (id) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, unread: false } : c
      ),
    })),
  archiveConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    })),
  deleteConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    })),
  createGroupConversation: ({ title, memberIds, creatorId }) => {
    const creator = creatorId ?? get().currentUser?.id ?? 'me';
    const uniqueMemberIds = [...new Set([creator, ...memberIds])].filter((id) => id.trim().length > 0);
    const groupTitle = title.trim() || 'New Group';
    const conversationId = `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const createdMessage: ConversationMessage = {
      id: `msg_${Date.now()}`,
      senderId: 'system',
      isSystem: true,
      systemTitle: 'Group created',
      text: `${groupTitle} was created.`,
      timestamp: 'just now',
      type: 'system',
      sender: 'system',
    };

    const nextConversation: Conversation = {
      id: conversationId,
      type: 'group',
      title: groupTitle,
      ownerId: creator,
      participantIds: uniqueMemberIds,
      botIds: [],
      lastMessage: createdMessage.text ?? 'Group created',
      lastMessageTime: createdMessage.timestamp,
      unread: false,
      messages: [createdMessage],
    };

    set((state) => ({
      conversations: [nextConversation, ...state.conversations],
    }));

    return conversationId;
  },
  deployBotToConversation: (conversationId, botId) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId || conversation.type !== 'group') {
          return conversation;
        }

        const existingBotIds = conversation.botIds ?? [];
        if (existingBotIds.includes(botId)) {
          return conversation;
        }

        const bot = state.availableChatBots.find((item) => item.id === botId);
        const deployedText = bot
          ? `${bot.name} deployed. Try ${bot.commandHint}`
          : 'A bot was deployed to this group.';

        const deployedMessage: ConversationMessage = {
          id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          senderId: 'system',
          isSystem: true,
          systemTitle: 'Bot deployed',
          text: deployedText,
          timestamp: 'just now',
          type: 'system',
          sender: 'system',
        };

        return {
          ...conversation,
          botIds: [...existingBotIds, botId],
          lastMessage: deployedMessage.text ?? conversation.lastMessage,
          lastMessageTime: deployedMessage.timestamp,
          messages: [...conversation.messages, deployedMessage],
        };
      }),
    })),
  undeployBotFromConversation: (conversationId, botId) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId || conversation.type !== 'group') {
          return conversation;
        }

        const nextBotIds = (conversation.botIds ?? []).filter((id) => id !== botId);
        if (nextBotIds.length === (conversation.botIds ?? []).length) {
          return conversation;
        }

        const bot = state.availableChatBots.find((item) => item.id === botId);
        const removedText = bot
          ? `${bot.name} removed from the group.`
          : 'A bot was removed from this group.';

        const removedMessage: ConversationMessage = {
          id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          senderId: 'system',
          isSystem: true,
          systemTitle: 'Bot removed',
          text: removedText,
          timestamp: 'just now',
          type: 'system',
          sender: 'system',
        };

        return {
          ...conversation,
          botIds: nextBotIds,
          lastMessage: removedMessage.text ?? conversation.lastMessage,
          lastMessageTime: removedMessage.timestamp,
          messages: [...conversation.messages, removedMessage],
        };
      }),
    })),
  appendConversationMessage: (conversationId, message) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const nextLastMessage = message.text
          ?? message.systemTitle
          ?? (message.offerPrice ? `Offer ${message.offerPrice}` : 'New message');

        return {
          ...conversation,
          lastMessage: nextLastMessage,
          lastMessageTime: message.timestamp,
          messages: [...conversation.messages, message],
        };
      }),
    })),
  replaceConversationMessages: (conversationId, messages) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        if (!messages.length) {
          return conversation;
        }

        const latestMessage = messages[messages.length - 1];
        const nextLastMessage = latestMessage.text
          ?? latestMessage.systemTitle
          ?? (latestMessage.offerPrice ? `Offer ${latestMessage.offerPrice}` : conversation.lastMessage);

        return {
          ...conversation,
          messages,
          lastMessage: nextLastMessage,
          lastMessageTime: latestMessage.timestamp,
        };
      }),
    })),

  userAvatar: null,
  userCover: null,
  profileMediaOverrides: {},
  hydrateProfileMediaOverrides: (overrides) =>
    set({
      profileMediaOverrides: overrides,
    }),
  setProfileMediaOverride: (userId, updates) =>
    set((state) => {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) {
        return state;
      }

      const existing = state.profileMediaOverrides[normalizedUserId] ?? {
        avatar: null,
        cover: null,
      };

      return {
        profileMediaOverrides: {
          ...state.profileMediaOverrides,
          [normalizedUserId]: {
            ...existing,
            ...updates,
          },
        },
      };
    }),
  updateUserAvatar: (uri) =>
    set((state) => {
      const targetIds = new Set<string>([MY_USER.id]);
      if (state.currentUser?.id) {
        targetIds.add(state.currentUser.id);
      }

      const nextOverrides = { ...state.profileMediaOverrides };
      targetIds.forEach((targetId) => {
        const existing = nextOverrides[targetId] ?? { avatar: null, cover: null };
        nextOverrides[targetId] = {
          ...existing,
          avatar: uri,
        };
      });

      return {
        userAvatar: uri,
        profileMediaOverrides: nextOverrides,
      };
    }),
  updateUserCover: (uri) =>
    set((state) => {
      const targetIds = new Set<string>([MY_USER.id]);
      if (state.currentUser?.id) {
        targetIds.add(state.currentUser.id);
      }

      const nextOverrides = { ...state.profileMediaOverrides };
      targetIds.forEach((targetId) => {
        const existing = nextOverrides[targetId] ?? { avatar: null, cover: null };
        nextOverrides[targetId] = {
          ...existing,
          cover: uri,
        };
      });

      return {
        userCover: uri,
        profileMediaOverrides: nextOverrides,
      };
    }),
}));
