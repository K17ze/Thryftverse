export type CoOwnedAssetStatus = 'offering' | 'active' | 'buyout_pending' | 'delisted';

export interface CoOwnedAsset {
  id: string;
  listingId: string;
  sellerId: string;
  title: string;
  image: string;
  totalShares: number;
  availableShares: number;
  initialPricePerShare: number;
  currentPricePerShare: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  status: CoOwnedAssetStatus;
  authPhotos: string[];
  createdAt: string;
  offeringEndsAt: string;
}

export interface ShareHolding {
  id: string;
  userId: string;
  assetId: string;
  sharesOwned: number;
  averageBuyPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  percentageOfTotal: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled';

export interface TradeOrder {
  id: string;
  userId: string;
  assetId: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  fee: number;
  status: OrderStatus;
  filledQuantity: number;
  createdAt: string;
  filledAt?: string;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  side: 'bid' | 'ask';
  orderCount: number;
}

export interface PricePoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Wallet {
  userId: string;
  izeBalance: number;
  fiatBalance: number;
  totalPortfolioValue: number;
  lockedBalance: number;
}

export type WalletTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_buy'
  | 'trade_sell'
  | 'fee'
  | 'buyout';

export interface WalletTransaction {
  id: string;
  userId: string;
  type: WalletTransactionType;
  amount: number;
  currency: '1ze' | 'GBP' | 'USD' | 'EUR';
  relatedOrderId?: string;
  relatedAssetId?: string;
  createdAt: string;
}

export interface BuyoutOffer {
  id: string;
  assetId: string;
  buyerId: string;
  sharesOwned: number;
  sharesNeeded: number;
  offerPricePerShare: number;
  totalCost: number;
  status: 'draft' | 'open' | 'accepted' | 'expired' | 'cancelled';
  expiresAt: string;
}
