import { describe, expect, it } from 'vitest';
import {
  buildTradeQuote,
  evaluateTradeSubmit,
  isTradeSubmitEnabled,
} from '../utils/tradeFlow';

const ELIGIBLE = { ok: true };
const BLOCKED = { ok: false, message: 'Complete KYC verification to access Co-Own markets.' };

describe('trade submit flow decisions', () => {
  it('enables submit and executes for valid market buy', () => {
    const quote = buildTradeQuote({
      orderMode: 'market',
      side: 'buy',
      quantityInput: '3',
      limitPriceInput: '',
      marketPrice: 2,
    });

    expect(isTradeSubmitEnabled({ assetFound: true, eligibility: ELIGIBLE, quote })).toBe(true);

    const decision = evaluateTradeSubmit({
      orderMode: 'market',
      side: 'buy',
      quantityInput: '3',
      limitPriceInput: '',
      marketPrice: 2,
      assetFound: true,
      eligibility: ELIGIBLE,
      maxSellUnits: 0,
    });

    expect(decision).toEqual({
      ok: true,
      kind: 'execute',
      message: 'Order can execute',
    });
  });

  it('blocks submit when compliance fails', () => {
    const quote = buildTradeQuote({
      orderMode: 'market',
      side: 'buy',
      quantityInput: '2',
      limitPriceInput: '',
      marketPrice: 1.8,
    });

    expect(isTradeSubmitEnabled({ assetFound: true, eligibility: BLOCKED, quote })).toBe(false);

    const decision = evaluateTradeSubmit({
      orderMode: 'market',
      side: 'buy',
      quantityInput: '2',
      limitPriceInput: '',
      marketPrice: 1.8,
      assetFound: true,
      eligibility: BLOCKED,
      maxSellUnits: 0,
    });

    expect(decision.ok).toBe(false);
    expect(decision.kind).toBe('error');
    expect(decision.message.toLowerCase()).toContain('kyc');
  });

  it('queues non-crossing limit buy orders', () => {
    const decision = evaluateTradeSubmit({
      orderMode: 'limit',
      side: 'buy',
      quantityInput: '5',
      limitPriceInput: '1.90',
      marketPrice: 2,
      assetFound: true,
      eligibility: ELIGIBLE,
      maxSellUnits: 0,
    });

    expect(decision).toEqual({
      ok: true,
      kind: 'queue',
      message: 'Offer sent to owners. Raise your offer for instant fill.',
    });
  });

  it('blocks sell when holdings are insufficient', () => {
    const decision = evaluateTradeSubmit({
      orderMode: 'market',
      side: 'sell',
      quantityInput: '9',
      limitPriceInput: '',
      marketPrice: 2,
      assetFound: true,
      eligibility: ELIGIBLE,
      maxSellUnits: 4,
    });

    expect(decision).toEqual({
      ok: false,
      kind: 'error',
      message: 'Not enough units in holdings',
    });
  });
});