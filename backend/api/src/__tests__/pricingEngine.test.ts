import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCountryPricing,
  findPricingArbitrageViolations,
  validatePricingProfileInput,
} from '../lib/pricingEngine.js';

test('calculateCountryPricing follows anchor formula', () => {
  const quote = calculateCountryPricing({
    anchorValue: 1000,
    fxRate: 1,
    markupBps: 1500,
    markdownBps: 2000,
    crossBorderFeeBps: 1000,
    pppFactor: 0.9,
  });

  assert.equal(quote.buyPrice, 1035);
  assert.equal(quote.sellPrice, 720);
  assert.equal(quote.crossBorderSellPrice, 648);
});

test('findPricingArbitrageViolations detects guaranteed profit loops', () => {
  const violations = findPricingArbitrageViolations([
    {
      countryCode: 'IN',
      currency: 'INR',
      anchorCurrency: 'INR',
      anchorValueInInr: 1000,
      fxRateInrToLocal: 1,
      buyPrice: 700,
      sellPrice: 650,
      crossBorderSellPrice: 640,
      buyPriceInAnchor: 700,
      sellPriceInAnchor: 650,
      crossBorderSellPriceInAnchor: 640,
      markupBps: 0,
      markdownBps: 0,
      crossBorderFeeBps: 0,
      pppFactor: 1,
      source: 'test',
      updatedAt: new Date().toISOString(),
    },
    {
      countryCode: 'GB',
      currency: 'GBP',
      anchorCurrency: 'INR',
      anchorValueInInr: 1000,
      fxRateInrToLocal: 0.01,
      buyPrice: 8,
      sellPrice: 7.8,
      crossBorderSellPrice: 7.5,
      buyPriceInAnchor: 800,
      sellPriceInAnchor: 780,
      crossBorderSellPriceInAnchor: 750,
      markupBps: 0,
      markdownBps: 0,
      crossBorderFeeBps: 0,
      pppFactor: 1,
      source: 'test',
      updatedAt: new Date().toISOString(),
    },
  ]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.buyCountry, 'IN');
  assert.equal(violations[0]?.sellCountry, 'GB');
  assert.equal(violations[0]?.guaranteedProfitInAnchor, 50);
});

test('validatePricingProfileInput enforces configured ranges', () => {
  validatePricingProfileInput({
    markupBps: 1500,
    markdownBps: 1000,
    crossBorderFeeBps: 500,
    pppFactor: 0.9,
  });

  assert.throws(
    () => {
      validatePricingProfileInput({
        markupBps: 100,
        markdownBps: 1000,
        crossBorderFeeBps: 500,
        pppFactor: 0.9,
      });
    },
    {
      message: /markupBps/,
    }
  );
});
