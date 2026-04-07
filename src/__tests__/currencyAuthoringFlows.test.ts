import { describe, expect, it } from 'vitest';
import {
  calculateOfferSummaryFromDisplay,
  convertDisplayToGbpAmount,
  convertGbpToDisplayAmount,
  getDefaultWithdrawDisplayAmount,
  getSuggestedBidDisplayAmount,
  sanitizeDecimalInput,
} from '../utils/currencyAuthoringFlows';
import { DEFAULT_GOLD_RATES } from '../utils/currency';

describe('currency authoring flow utilities', () => {
  it('sanitizes decimal text input consistently', () => {
    expect(sanitizeDecimalInput('12..34abc')).toBe('12.34');
    expect(sanitizeDecimalInput('..9,1x')).toBe('.91');
  });

  it('keeps GBP conversions stable for bid suggestions', () => {
    const suggested = getSuggestedBidDisplayAmount(45, 'GBP', DEFAULT_GOLD_RATES);
    expect(suggested).toBe(46.35);
  });

  it('round-trips non-GBP display amounts back to GBP', () => {
    const gbpAmount = 110.75;
    const display = convertGbpToDisplayAmount(gbpAmount, 'USD', DEFAULT_GOLD_RATES);
    const roundTrip = convertDisplayToGbpAmount(display, 'USD', DEFAULT_GOLD_RATES);

    expect(roundTrip).toBeCloseTo(gbpAmount, 8);
  });

  it('calculates offer fee totals using GBP settlement amounts', () => {
    const summary = calculateOfferSummaryFromDisplay(50, 'GBP', DEFAULT_GOLD_RATES);

    expect(summary.offerGbp).toBe(50);
    expect(summary.platformChargeGbp).toBe(3.2);
    expect(summary.buyerProtectionFeeGbp).toBe(summary.platformChargeGbp);
    expect(summary.totalGbp).toBe(53.2);
  });

  it('computes a safe default withdraw display amount', () => {
    const display = getDefaultWithdrawDisplayAmount(120.5, 'EUR', DEFAULT_GOLD_RATES);
    const settled = convertDisplayToGbpAmount(display, 'EUR', DEFAULT_GOLD_RATES);

    expect(display).toBeGreaterThan(0);
    expect(settled).toBeCloseTo(120.5, 2);
  });
});
