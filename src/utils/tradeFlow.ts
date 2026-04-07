import { sanitizeDecimalInput, sanitizeIntegerInput } from './currencyAuthoringFlows';

export const SYNDICATE_FEE_RATE = 0.01;
export const SYNDICATE_MAX_UNITS = 20;

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
  const sanitized = sanitizeIntegerInput(rawValue);
  if (!sanitized) {
    return '';
  }

  const parsed = Math.floor(Number(sanitized));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '1';
  }

  return String(Math.min(SYNDICATE_MAX_UNITS, parsed));
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
  const fee = grossValue * SYNDICATE_FEE_RATE;
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
    && input.quote.quantity <= SYNDICATE_MAX_UNITS
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

  if (quote.quantity > SYNDICATE_MAX_UNITS) {
    return {
      ok: false,
      kind: 'error',
      message: `Quantity must be between 1 and ${SYNDICATE_MAX_UNITS}`,
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
        message: 'Enter a valid offer price',
      };
    }

    const buyNotCrossing = input.side === 'buy' && quote.limitPrice < input.marketPrice * 0.995;
    const sellNotCrossing = input.side === 'sell' && quote.limitPrice > input.marketPrice * 1.005;

    if (buyNotCrossing || sellNotCrossing) {
      return {
        ok: true,
        kind: 'queue',
        message: input.side === 'buy'
          ? 'Offer sent to owners. Raise your offer for instant fill.'
          : 'Ask sent to owners. Lower your ask for instant fill.',
      };
    }
  }

  return {
    ok: true,
    kind: 'execute',
    message: 'Order can execute',
  };
}