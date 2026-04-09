import { fetchJson } from '../lib/apiClient';

export type AuctionStatus = 'upcoming' | 'live' | 'ended';

export interface MarketAuction {
  id: string;
  listingId: string;
  sellerId: string;
  title: string;
  imageUrl: string | null;
  startsAt: string;
  endsAt: string;
  msToStart: number;
  msToEnd: number;
  startingBidGbp: number;
  currentBidGbp: number;
  buyNowPriceGbp: number | null;
  bidCount: number;
  status: AuctionStatus;
}

export interface MarketAuctionBid {
  id: number;
  auctionId: string;
  bidderId: string;
  amountGbp: number;
  createdAt: string;
}

export interface MarketAuctionBidResult {
  bid: MarketAuctionBid;
  auction: {
    id: string;
    currentBidGbp: number;
    bidCount: number;
  };
  aml?: {
    alertId: string;
    status: string;
  } | null;
}

export type CoOwnSettlementMode = 'GBP' | 'TVUSD' | 'HYBRID';

export interface MarketCoOwnAsset {
  id: string;
  listingId: string;
  issuerId: string;
  title: string;
  imageUrl: string | null;
  totalUnits: number;
  availableUnits: number;
  unitPriceGbp: number;
  unitPriceStable: number;
  settlementMode: CoOwnSettlementMode;
  issuerJurisdiction: string | null;
  marketMovePct24h: number;
  holders: number;
  volume24hGbp: number;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CoOwnOrderSide = 'buy' | 'sell';

export interface MarketCoOwnOrder {
  id: number;
  assetId: string;
  userId: string;
  side: CoOwnOrderSide;
  orderType?: 'market' | 'limit';
  limitPriceGbp?: number | null;
  units: number;
  remainingUnits?: number;
  filledUnits?: number;
  unitPriceGbp: number;
  feeGbp: number;
  totalGbp: number;
  status: 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
  createdAt: string;
  updatedAt?: string;
}

export interface MarketCoOwnBuyoutOffer {
  id: string;
  assetId: string;
  bidderUserId: string;
  offerPriceGbp: number;
  targetUnits: number;
  acceptedUnits: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type MarketHistoryChannel = 'auction' | 'co-own';
export type MarketHistoryAction = 'bid' | 'buy-units' | 'sell-units';

export interface MarketHistoryItem {
  id: string;
  channel: MarketHistoryChannel;
  action: MarketHistoryAction;
  referenceId: string;
  amountGbp: number;
  units: number | null;
  unitPriceGbp: number | null;
  feeGbp: number | null;
  status: 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | null;
  note: string | null;
  timestamp: string;
}

export interface MarketHistoryCursor {
  cursorTs: string;
  cursorId: string;
}

export interface MarketHistoryPage {
  items: MarketHistoryItem[];
  pageInfo: {
    hasMore: boolean;
    nextCursor?: MarketHistoryCursor;
  };
}

interface ListAuctionsResponse {
  ok: true;
  items: MarketAuction[];
}

interface PlaceAuctionBidResponse {
  ok: true;
  bid: MarketAuctionBid;
  auction: MarketAuctionBidResult['auction'];
  aml?: {
    alertId: string;
    status: string;
  } | null;
}

interface ListAuctionBidsResponse {
  ok: true;
  items: MarketAuctionBid[];
}

interface ListCoOwnAssetsResponse {
  ok: true;
  items: MarketCoOwnAsset[];
}

interface PlaceCoOwnOrderResponse {
  ok: true;
  order: MarketCoOwnOrder;
  asset: {
    id: string;
    availableUnits: number;
    holders: number;
    volume24hGbp: number;
    updatedAt: string;
  };
  aml?: {
    alertId: string;
    status: string;
  } | null;
}

interface CreateCoOwnBuyoutOfferResponse {
  ok: true;
  offer: MarketCoOwnBuyoutOffer;
  aml?: {
    alertId: string;
    status: string;
  } | null;
}

interface ListCoOwnOrdersResponse {
  ok: true;
  items: MarketCoOwnOrder[];
}

interface ListUserMarketHistoryResponse {
  ok: true;
  items: MarketHistoryItem[];
  pageInfo: {
    hasMore: boolean;
    nextCursor?: MarketHistoryCursor;
  };
}

interface ListAuctionsOptions {
  status?: AuctionStatus;
  sellerId?: string;
  limit?: number;
}

interface ListAuctionBidsOptions {
  limit?: number;
}

interface ListCoOwnAssetsOptions {
  openOnly?: boolean;
  issuerId?: string;
  limit?: number;
}

interface ListCoOwnAssetOrdersOptions {
  limit?: number;
}

interface ListUserMarketHistoryOptions {
  channel?: 'all' | MarketHistoryChannel;
  limit?: number;
  cursorTs?: string;
  cursorId?: string;
}

interface PlaceAuctionBidInput {
  bidderId: string;
  amountGbp: number;
}

interface PlaceCoOwnOrderInput {
  userId: string;
  side: CoOwnOrderSide;
  units: number;
  orderType?: 'market' | 'limit';
  limitPriceGbp?: number;
}

interface CreateCoOwnBuyoutOfferInput {
  bidderUserId: string;
  offerPriceGbp: number;
  targetUnits?: number;
  expiresInHours?: number;
  metadata?: Record<string, unknown>;
}

function toQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    search.set(key, String(value));
  });

  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export async function listAuctions(options: ListAuctionsOptions = {}): Promise<MarketAuction[]> {
  const query = toQuery({
    status: options.status,
    sellerId: options.sellerId,
    limit: options.limit,
  });
  const payload = await fetchJson<ListAuctionsResponse>(`/auctions${query}`);
  return payload.items;
}

export async function placeAuctionBid(
  auctionId: string,
  input: PlaceAuctionBidInput
): Promise<MarketAuctionBidResult> {
  const payload = await fetchJson<PlaceAuctionBidResponse>(
    `/auctions/${encodeURIComponent(auctionId)}/bids`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  return {
    bid: payload.bid,
    auction: payload.auction,
    aml: payload.aml ?? null,
  };
}

export async function listAuctionBids(
  auctionId: string,
  options: ListAuctionBidsOptions = {}
): Promise<MarketAuctionBid[]> {
  const query = toQuery({
    limit: options.limit,
  });

  const payload = await fetchJson<ListAuctionBidsResponse>(
    `/auctions/${encodeURIComponent(auctionId)}/bids${query}`
  );

  return payload.items;
}

export async function listCoOwnAssets(
  options: ListCoOwnAssetsOptions = {}
): Promise<MarketCoOwnAsset[]> {
  const query = toQuery({
    openOnly: options.openOnly,
    issuerId: options.issuerId,
    limit: options.limit,
  });
  const payload = await fetchJson<ListCoOwnAssetsResponse>(`/co-own/assets${query}`);
  return payload.items;
}

export async function placeCoOwnOrder(
  assetId: string,
  input: PlaceCoOwnOrderInput
): Promise<PlaceCoOwnOrderResponse> {
  return fetchJson<PlaceCoOwnOrderResponse>(
    `/co-own/assets/${encodeURIComponent(assetId)}/orders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
}

export async function createCoOwnBuyoutOffer(
  assetId: string,
  input: CreateCoOwnBuyoutOfferInput
): Promise<CreateCoOwnBuyoutOfferResponse> {
  return fetchJson<CreateCoOwnBuyoutOfferResponse>(
    `/co-own/assets/${encodeURIComponent(assetId)}/buyout-offers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
}

export async function listCoOwnAssetOrders(
  assetId: string,
  options: ListCoOwnAssetOrdersOptions = {}
): Promise<MarketCoOwnOrder[]> {
  const query = toQuery({
    limit: options.limit,
  });

  const payload = await fetchJson<ListCoOwnOrdersResponse>(
    `/co-own/assets/${encodeURIComponent(assetId)}/orders${query}`
  );

  return payload.items;
}

export async function listUserMarketHistory(
  userId: string,
  options: ListUserMarketHistoryOptions = {}
): Promise<MarketHistoryPage> {
  const query = toQuery({
    channel: options.channel,
    limit: options.limit,
    cursorTs: options.cursorTs,
    cursorId: options.cursorId,
  });

  const payload = await fetchJson<ListUserMarketHistoryResponse>(
    `/users/${encodeURIComponent(userId)}/market-history${query}`
  );

  return {
    items: payload.items,
    pageInfo: payload.pageInfo,
  };
}
