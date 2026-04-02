import { describe, expect, it } from 'vitest';
import {
  buildCreateSyndicatePrefillFromSell,
  getCreateSyndicateInitialState,
} from '../utils/syndicatePrefill';

describe('sell to syndicate prefill mapping', () => {
  it('builds route params for CreateSyndicate from sell draft values', () => {
    const result = buildCreateSyndicatePrefillFromSell({
      listingId: 'listing-01',
      shareCountInput: '20',
      sharePriceInput: '2.35',
      offeringWindowHours: 48,
      authPhotos: ['photo-a'],
    });

    expect(result.ok).toBe(true);
    expect(result.params).toEqual({
      listingId: 'listing-01',
      totalUnits: 20,
      unitPriceDisplay: 2.35,
      offeringWindowHours: 48,
      authPhotos: ['photo-a'],
    });
  });

  it('rejects invalid syndicate drafts before navigation', () => {
    const invalidShares = buildCreateSyndicatePrefillFromSell({
      shareCountInput: '21',
      sharePriceInput: '1.2',
      offeringWindowHours: 24,
      authPhotos: ['proof'],
    });

    const invalidPhotos = buildCreateSyndicatePrefillFromSell({
      shareCountInput: '20',
      sharePriceInput: '1.2',
      offeringWindowHours: 24,
      authPhotos: [],
    });

    expect(invalidShares.ok).toBe(false);
    expect(invalidShares.error).toContain('share count');
    expect(invalidPhotos.ok).toBe(false);
    expect(invalidPhotos.error).toContain('authentication photo');
  });

  it('hydrates create screen initial state from prefill data', () => {
    const initial = getCreateSyndicateInitialState(
      {
        listingId: 'listing-prefill',
        totalUnits: 250,
        unitPriceDisplay: 1.87,
        offeringWindowHours: 72,
        authPhotos: ['proof-1', 'proof-2'],
      },
      'listing-default'
    );

    expect(initial).toEqual({
      selectedListingId: 'listing-prefill',
      totalUnitsInput: '20',
      unitPriceInput: '1.87',
    });
  });
});
