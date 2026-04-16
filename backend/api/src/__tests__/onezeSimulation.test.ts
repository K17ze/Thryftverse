import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCountryPricing,
  findPricingArbitrageViolations,
  type OnezePricingQuote,
} from '../lib/pricingEngine.js';

function buildQuote(input: {
  countryCode: string;
  currency: string;
  anchorValueInInr: number;
  fxRateInrToLocal: number;
  markupBps: number;
  markdownBps: number;
  crossBorderFeeBps: number;
  pppFactor: number;
}): OnezePricingQuote {
  const pricing = calculateCountryPricing({
    anchorValue: input.anchorValueInInr,
    fxRate: input.fxRateInrToLocal,
    markupBps: input.markupBps,
    markdownBps: input.markdownBps,
    crossBorderFeeBps: input.crossBorderFeeBps,
    pppFactor: input.pppFactor,
  });

  return {
    countryCode: input.countryCode,
    currency: input.currency,
    anchorCurrency: 'INR',
    anchorValueInInr: input.anchorValueInInr,
    fxRateInrToLocal: input.fxRateInrToLocal,
    buyPrice: pricing.buyPrice,
    sellPrice: pricing.sellPrice,
    crossBorderSellPrice: pricing.crossBorderSellPrice,
    buyPriceInAnchor: pricing.buyPriceInAnchor,
    sellPriceInAnchor: pricing.sellPriceInAnchor,
    crossBorderSellPriceInAnchor: pricing.crossBorderSellPriceInAnchor,
    markupBps: input.markupBps,
    markdownBps: input.markdownBps,
    crossBorderFeeBps: input.crossBorderFeeBps,
    pppFactor: input.pppFactor,
    source: 'simulation',
    updatedAt: new Date().toISOString(),
  };
}

test('cross-country arbitrage simulation: seeded profile matrix is non-profitable', () => {
  const quotes = [
    buildQuote({
      countryCode: 'IN',
      currency: 'INR',
      anchorValueInInr: 1000,
      fxRateInrToLocal: 1,
      markupBps: 1500,
      markdownBps: 2000,
      crossBorderFeeBps: 1000,
      pppFactor: 0.9,
    }),
    buildQuote({
      countryCode: 'GB',
      currency: 'GBP',
      anchorValueInInr: 1000,
      fxRateInrToLocal: 0.011,
      markupBps: 1500,
      markdownBps: 1800,
      crossBorderFeeBps: 1000,
      pppFactor: 0.9,
    }),
  ];

  const violations = findPricingArbitrageViolations(quotes);
  assert.equal(violations.length, 0);
});

test('FX fluctuation impact simulation: shocks preserve negative arbitrage envelope', () => {
  const fxScenarios = [0.0095, 0.0105, 0.011, 0.012, 0.0135];

  for (const gbpFx of fxScenarios) {
    const quotes = [
      buildQuote({
        countryCode: 'IN',
        currency: 'INR',
        anchorValueInInr: 1000,
        fxRateInrToLocal: 1,
        markupBps: 1700,
        markdownBps: 1500,
        crossBorderFeeBps: 1200,
        pppFactor: 0.9,
      }),
      buildQuote({
        countryCode: 'GB',
        currency: 'GBP',
        anchorValueInInr: 1000,
        fxRateInrToLocal: gbpFx,
        markupBps: 1700,
        markdownBps: 1500,
        crossBorderFeeBps: 1200,
        pppFactor: 0.9,
      }),
    ];

    const violations = findPricingArbitrageViolations(quotes);
    assert.equal(
      violations.length,
      0,
      `Expected no arbitrage violations under FX scenario INR/GBP=${gbpFx}`
    );
  }
});

test('mass withdrawal and liquidity stress simulation: spread stays positive at scale', () => {
  const quote = buildQuote({
    countryCode: 'IN',
    currency: 'INR',
    anchorValueInInr: 1000,
    fxRateInrToLocal: 1,
    markupBps: 2000,
    markdownBps: 1500,
    crossBorderFeeBps: 1000,
    pppFactor: 0.9,
  });

  const mintedIze = 125_000;
  const redeemedIze = 82_500;

  const buyNotional = mintedIze * quote.buyPrice;
  const sellNotional = redeemedIze * quote.sellPrice;
  const stressRevenue = buyNotional - sellNotional;

  assert.ok(stressRevenue > 0, 'Stress scenario should preserve positive spread revenue');
  assert.ok(quote.buyPrice > quote.sellPrice, 'Buy price must remain above sell price');
  assert.ok(
    quote.sellPrice > quote.crossBorderSellPrice,
    'Cross-border sell price must remain below domestic sell price'
  );
});
