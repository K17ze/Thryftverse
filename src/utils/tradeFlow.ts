import { sanitizeDecimalInput, sanitizeIntegerInput } from './currencyAuthoringFlows';

export type TradeOrderMode = 'market' | 'limit';
export type TradeSide = 'buy' | 'sell';

export interface TradeEligibility {
  ok: boolean;
  message?: string;
}

export interface TradeQuoteInput {
  orderMode: TradeOrderMode;
  side: TradeSide;
  quantityInput: string;
  limitPriceInput: string;
  marketPrice: number;
}

export interface TradeQuote {
  orderMode: TradeOrderMode;
  quantity: number;
  isValidQty: boolean;
  limitPrice: number;
  hasLimitPrice: boolean;
  executionPrice: number;
  grossValue: number;
  fee: number;
  netValue: number;
}

export interface TradeSubmitInput extends TradeQuoteInput {
  assetFound: boolean;
  eligibility: TradeEligibility;
  maxSellUnits: number;
}

export interface TradeSubmitDecision {
  ok: boolean;
  kind: 'error' | 'queue' | 'execute';
  message: string;
}

export function sanitizeTradeQuantityInput(rawValue: string) {
  return sanitizeIntegerInput(rawValue);
}

export function sanitizeTradePriceInput(rawValue: string) {
  return sanitizeDecimalInput(rawValue);
}

export function buildTradeQuote(input: TradeQuoteInput): TradeQuote {
  const quantity = Math.floor(Number(input.quantityInput));
  const isValidQty = Number.isFinite(quantity) && quantity > 0;

  const limitPrice = Number(input.limitPriceInput);
  const hasLimitPrice = Number.isFinite(limitPrice) && limitPrice > 0;

  const executionPrice =
    input.orderMode === 'limit' && hasLimitPrice
      ? limitPrice
      : input.marketPrice * (input.side === 'buy' ? 1.003 : 0.997);

  const grossValue = isValidQty ? quantity * executionPrice : 0;
  const fee = grossValue * 0.005;
  const netValue = input.side === 'buy' ? grossValue + fee : grossValue - fee;

  return {
    orderMode: input.orderMode,
    quantity,
    isValidQty,
    limitPrice,
    hasLimitPrice,
    executionPrice,
    grossValue,
    fee,
    netValue,
  };
}

export function isTradeSubmitEnabled(input: {
  assetFound: boolean;
  eligibility: TradeEligibility;
  quote: TradeQuote;
}) {
  return (
    input.assetFound
    && input.eligibility.ok
    && input.quote.isValidQty
    && (input.quote.orderMode === 'market' || input.quote.hasLimitPrice)
  );
}

export function evaluateTradeSubmit(input: TradeSubmitInput): TradeSubmitDecision {
  const quote = buildTradeQuote(input);

  if (!input.assetFound) {
    return {
      ok: false,
      kind: 'error',
      message: 'Asset not found',
    };
  }

  if (!input.eligibility.ok) {
    return {
      ok: false,
      kind: 'error',
      message: input.eligibility.message ?? 'Compliance checks required',
    };
  }

  if (!quote.isValidQty) {
    return {
      ok: false,
      kind: 'error',
      message: 'Enter a valid quantity',
    };
  }

  if (input.side === 'sell' && quote.quantity > input.maxSellUnits) {
    return {
      ok: false,
      kind: 'error',
      message: 'Not enough units in holdings',
    };
  }

  if (input.orderMode === 'limit') {
    if (!quote.hasLimitPrice) {
      return {
        ok: false,
        kind: 'error',
        message: 'Enter a valid limit price',
      };
    }

    const buyNotCrossing = input.side === 'buy' && quote.limitPrice < input.marketPrice * 0.995;
    const sellNotCrossing = input.side === 'sell' && quote.limitPrice > input.marketPrice * 1.005;

    if (buyNotCrossing || sellNotCrossing) {
      return {
        ok: true,
        kind: 'queue',
        message: 'Limit order queued (prototype)',
      };
    }
  }

  return {
    ok: true,
    kind: 'execute',
    message: 'Order can execute',
  };
}