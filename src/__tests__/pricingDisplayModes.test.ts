import { describe, expect, it } from 'vitest';
import {
  CurrencyDisplayMode,
  DEFAULT_GOLD_RATES,
  formatPrice,
  toIze,
} from '../utils/currency';

function buildPricingSurface(mode: CurrencyDisplayMode) {
  const itemIze = toIze(89.5, 'GBP', DEFAULT_GOLD_RATES);
  const protectionIze = toIze(5.18, 'GBP', DEFAULT_GOLD_RATES);
  const postageIze = toIze(2.89, 'GBP', DEFAULT_GOLD_RATES);
  const totalIze = itemIze + protectionIze + postageIze;
  const promoteIze = toIze(1.99, 'GBP', DEFAULT_GOLD_RATES);

  return {
    mode,
    itemPrice: formatPrice({ izeAmount: itemIze, currencyCode: 'GBP', displayMode: mode }),
    buyerProtectionLine: `incl. ${formatPrice({
      izeAmount: protectionIze,
      currencyCode: 'GBP',
      displayMode: mode,
    })} Buyer Protection fee`,
    checkoutTotal: formatPrice({ izeAmount: totalIze, currencyCode: 'GBP', displayMode: mode }),
    promoteCta: `Promote for ${formatPrice({ izeAmount: promoteIze, currencyCode: 'GBP', displayMode: mode })}`,
  };
}

describe('pricing display-mode snapshots', () => {
  it('keeps key pricing copy stable across fiat/ize/both modes', () => {
    const views = [
      buildPricingSurface('fiat'),
      buildPricingSurface('ize'),
      buildPricingSurface('both'),
    ];

    expect(views).toMatchInlineSnapshot(`
      [
        {
          "buyerProtectionLine": "incl. £5.18 Buyer Protection fee",
          "checkoutTotal": "£97.57",
          "itemPrice": "£89.50",
          "mode": "fiat",
          "promoteCta": "Promote for £1.99",
        },
        {
          "buyerProtectionLine": "incl. 0.068883 1ze Buyer Protection fee",
          "checkoutTotal": "1.297473 1ze",
          "itemPrice": "1.190160 1ze",
          "mode": "ize",
          "promoteCta": "Promote for 0.026463 1ze",
        },
        {
          "buyerProtectionLine": "incl. 0.068883 1ze · £5.18 Buyer Protection fee",
          "checkoutTotal": "1.297473 1ze · £97.57",
          "itemPrice": "1.190160 1ze · £89.50",
          "mode": "both",
          "promoteCta": "Promote for 0.026463 1ze · £1.99",
        },
      ]
    `);
  });
});