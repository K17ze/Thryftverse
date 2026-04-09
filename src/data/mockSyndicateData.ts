import { MOCK_CO_OWN_ASSETS, CoOwnAsset } from './tradeHub';
import {
  BuyoutOffer,
  OrderBookEntry,
  PricePoint,
  TradeOrder,
  Wallet,
  WalletTransaction,
} from './syndicateModels';

export type ChartRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

const now = Date.now();

function createPriceSeries(basePrice: number, points: number, stepMs: number): PricePoint[] {
  const series: PricePoint[] = [];
  let lastClose = basePrice;

  for (let i = points - 1; i >= 0; i -= 1) {
    const seed = Math.sin(i * 0.7) * 0.018;
    const drift = Math.cos(i * 0.21) * 0.012;
    const open = Number(lastClose.toFixed(4));
    const close = Number((basePrice * (1 + seed + drift)).toFixed(4));
    const high = Number((Math.max(open, close) * 1.01).toFixed(4));
    const low = Number((Math.min(open, close) * 0.99).toFixed(4));

    series.push({
      timestamp: new Date(now - i * stepMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.round(200 + Math.abs(seed) * 6000 + Math.abs(drift) * 3200),
    });

    lastClose = close;
  }

  return series;
}

const PRICE_SERIES: Record<string, PricePoint[]> = MOCK_CO_OWN_ASSETS.reduce((acc, asset) => {
  acc[asset.id] = createPriceSeries(asset.unitPriceGBP, 90, 60 * 60 * 1000);
  return acc;
}, {} as Record<string, PricePoint[]>);

const ORDER_BOOK: Record<string, OrderBookEntry[]> = MOCK_CO_OWN_ASSETS.reduce((acc, asset) => {
  const center = asset.unitPriceGBP;
  const bids: OrderBookEntry[] = [
    { price: Number((center * 0.998).toFixed(2)), quantity: 2, side: 'bid', orderCount: 4 },
    { price: Number((center * 0.994).toFixed(2)), quantity: 4, side: 'bid', orderCount: 7 },
    { price: Number((center * 0.99).toFixed(2)), quantity: 6, side: 'bid', orderCount: 8 },
  ];

  const asks: OrderBookEntry[] = [
    { price: Number((center * 1.002).toFixed(2)), quantity: 3, side: 'ask', orderCount: 5 },
    { price: Number((center * 1.006).toFixed(2)), quantity: 5, side: 'ask', orderCount: 6 },
    { price: Number((center * 1.01).toFixed(2)), quantity: 7, side: 'ask', orderCount: 9 },
  ];

  acc[asset.id] = [...bids, ...asks].sort((a, b) => a.price - b.price);
  return acc;
}, {} as Record<string, OrderBookEntry[]>);

export const MOCK_TRADE_ORDERS: TradeOrder[] = [
  {
    id: 'ord_001',
    userId: 'u1',
    assetId: 's1',
    side: 'buy',
    type: 'market',
    quantity: 12,
    pricePerShare: 1.49,
    totalAmount: 17.88,
    fee: 0.09,
    status: 'filled',
    filledQuantity: 12,
    createdAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    filledAt: new Date(now - 4 * 60 * 60 * 1000 + 15 * 1000).toISOString(),
  },
  {
    id: 'ord_002',
    userId: 'u1',
    assetId: 's3',
    side: 'sell',
    type: 'limit',
    quantity: 8,
    pricePerShare: 1.04,
    totalAmount: 8.32,
    fee: 0.04,
    status: 'partial',
    filledQuantity: 5,
    createdAt: new Date(now - 90 * 60 * 1000).toISOString(),
  },
  {
    id: 'ord_003',
    userId: 'u1',
    assetId: 's2',
    side: 'buy',
    type: 'limit',
    quantity: 20,
    pricePerShare: 2.01,
    totalAmount: 40.2,
    fee: 0.2,
    status: 'pending',
    filledQuantity: 0,
    createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
  },
];

export const MOCK_WALLET: Wallet = {
  userId: 'u1',
  izeBalance: 3.781223,
  fiatBalance: 284.35,
  totalPortfolioValue: 521.9,
  lockedBalance: 41.2,
};

export const MOCK_WALLET_TRANSACTIONS: WalletTransaction[] = [
  {
    id: 'wtx_001',
    userId: 'u1',
    type: 'deposit',
    amount: 120,
    currency: 'GBP',
    createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'wtx_002',
    userId: 'u1',
    type: 'trade_buy',
    amount: -17.97,
    currency: 'GBP',
    relatedOrderId: 'ord_001',
    relatedAssetId: 's1',
    createdAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'wtx_003',
    userId: 'u1',
    type: 'fee',
    amount: -0.09,
    currency: 'GBP',
    relatedOrderId: 'ord_001',
    relatedAssetId: 's1',
    createdAt: new Date(now - 4 * 60 * 60 * 1000 + 20 * 1000).toISOString(),
  },
];

export const MOCK_BUYOUT_OFFERS: BuyoutOffer[] = [
  {
    id: 'buyout_001',
    assetId: 's4',
    buyerId: 'u2',
    sharesOwned: 14,
    sharesNeeded: 6,
    offerPricePerShare: 2.98,
    totalCost: 17.88,
    status: 'open',
    expiresAt: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
  },
];

function trimByRange(points: PricePoint[], range: ChartRange): PricePoint[] {
  if (range === 'ALL') {
    return points;
  }

  const size =
    range === '1H'
      ? 6
      : range === '1D'
        ? 24
        : range === '1W'
          ? 7 * 24
          : 30 * 24;

  return points.slice(Math.max(0, points.length - size));
}

export function getPriceSeries(assetId: string, range: ChartRange): PricePoint[] {
  const points = PRICE_SERIES[assetId] ?? [];
  return trimByRange(points, range);
}

export function getOrderBookSnapshot(assetId: string): OrderBookEntry[] {
  return ORDER_BOOK[assetId] ?? [];
}

export function getOrderHistoryForAsset(assetId?: string): TradeOrder[] {
  if (!assetId) {
    return MOCK_TRADE_ORDERS;
  }

  return MOCK_TRADE_ORDERS.filter((order) => order.assetId === assetId);
}

export function resolveAssetMarketState(
  asset: CoOwnAsset,
  runtime?: {
    availableUnits: number;
    holders: number;
    volume24hGBP: number;
    yourUnits: number;
    unitPriceGBP: number;
    unitPriceStable: number;
    marketMovePct24h: number;
    avgEntryPriceGBP: number;
    realizedProfitGBP: number;
  }
): CoOwnAsset {
  if (!runtime) {
    return asset;
  }

  return {
    ...asset,
    availableUnits: runtime.availableUnits,
    holders: runtime.holders,
    volume24hGBP: runtime.volume24hGBP,
    yourUnits: runtime.yourUnits,
    unitPriceGBP: runtime.unitPriceGBP,
    unitPriceStable: runtime.unitPriceStable,
    marketMovePct24h: runtime.marketMovePct24h,
    avgEntryPriceGBP: runtime.avgEntryPriceGBP,
    realizedProfitGBP: runtime.realizedProfitGBP,
  };
}
