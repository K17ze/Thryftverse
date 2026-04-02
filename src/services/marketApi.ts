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
}

export type SyndicateSettlementMode = 'GBP' | 'TVUSD' | 'HYBRID';

export interface MarketSyndicateAsset {
  id: string;
  listingId: string;
  issuerId: string;
  title: string;
  imageUrl: string | null;
  totalUnits: number;
  availableUnits: number;
  unitPriceGbp: number;
  unitPriceStable: number;
  settlementMode: SyndicateSettlementMode;
  issuerJurisdiction: string | null;
  marketMovePct24h: number;
  holders: number;
  volume24hGbp: number;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SyndicateOrderSide = 'buy' | 'sell';

export interface MarketSyndicateOrder {
  id: number;
  assetId: string;
  userId: string;
  side: SyndicateOrderSide;
  units: number;
  unitPriceGbp: number;
  feeGbp: number;
  totalGbp: number;
  status: 'filled' | 'rejected';
  createdAt: string;
}

export type MarketHistoryChannel = 'auction' | 'syndicate';
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
  status: 'filled' | 'rejected' | null;
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
}

interface ListAuctionBidsResponse {
  ok: true;
  items: MarketAuctionBid[];
}

interface ListSyndicateAssetsResponse {
  ok: true;
  items: MarketSyndicateAsset[];
}

interface PlaceSyndicateOrderResponse {
  ok: true;
  order: MarketSyndicateOrder;
  asset: {
    id: string;
    availableUnits: number;
    holders: number;
    volume24hGbp: number;
    updatedAt: string;
  };
}

interface ListSyndicateOrdersResponse {
  ok: true;
  items: MarketSyndicateOrder[];
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
  limit?: number;
}

interface ListAuctionBidsOptions {
  limit?: number;
}

interface ListSyndicateAssetsOptions {
  openOnly?: boolean;
  limit?: number;
}

interface ListSyndicateAssetOrdersOptions {
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

interface PlaceSyndicateOrderInput {
  userId: string;
  side: SyndicateOrderSide;
  units: number;
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

export async function listSyndicateAssets(
  options: ListSyndicateAssetsOptions = {}
): Promise<MarketSyndicateAsset[]> {
  const query = toQuery({
    openOnly: options.openOnly,
    limit: options.limit,
  });
  const payload = await fetchJson<ListSyndicateAssetsResponse>(`/syndicate/assets${query}`);
  return payload.items;
}

export async function placeSyndicateOrder(
  assetId: string,
  input: PlaceSyndicateOrderInput
): Promise<PlaceSyndicateOrderResponse> {
  return fetchJson<PlaceSyndicateOrderResponse>(
    `/syndicate/assets/${encodeURIComponent(assetId)}/orders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
}

export async function listSyndicateAssetOrders(
  assetId: string,
  options: ListSyndicateAssetOrdersOptions = {}
): Promise<MarketSyndicateOrder[]> {
  const query = toQuery({
    limit: options.limit,
  });

  const payload = await fetchJson<ListSyndicateOrdersResponse>(
    `/syndicate/assets/${encodeURIComponent(assetId)}/orders${query}`
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
