import { beforeEach, describe, expect, it } from 'vitest';
import type { SyndicateAsset } from '../data/tradeHub';
import { useStore } from '../store/useStore';

const SAMPLE_ASSET: SyndicateAsset = {
  id: 's_smoke_1',
  listingId: 'l_smoke_1',
  issuerId: 'u_issuer',
  title: 'Smoke Asset',
  image: 'https://picsum.photos/seed/smoke-asset/400/400',
  totalUnits: 100,
  availableUnits: 100,
  unitPriceGBP: 2,
  unitPriceStable: 2.56,
  settlementMode: 'HYBRID',
  issuerJurisdiction: 'GB',
  marketMovePct24h: 0,
  holders: 0,
  volume24hGBP: 0,
  yourUnits: 0,
  avgEntryPriceGBP: 2,
  realizedProfitGBP: 0,
  isOpen: true,
};

function resetStore() {
  useStore.setState(useStore.getInitialState(), true);
}

describe('syndicate trade lifecycle smoke', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().updateSyndicateCompliance({
      countryCode: 'GB',
      kycVerified: true,
      riskDisclosureAccepted: true,
      stableCoinWalletConnected: true,
    });
  });

  it('completes buy -> sell lifecycle and writes order history entries', () => {
    const state = useStore.getState();

    const buyResult = state.buySyndicateUnits(SAMPLE_ASSET, 'u_buyer', 12);
    expect(buyResult.ok).toBe(true);

    const runtimeAfterBuy = useStore.getState().syndicateRuntime[SAMPLE_ASSET.id];
    expect(runtimeAfterBuy).toBeDefined();
    expect(runtimeAfterBuy.availableUnits).toBe(88);
    expect(runtimeAfterBuy.yourUnits).toBe(12);

    const sellResult = useStore.getState().sellSyndicateUnits(SAMPLE_ASSET, 'u_seller', 5);
    expect(sellResult.ok).toBe(true);

    const runtimeAfterSell = useStore.getState().syndicateRuntime[SAMPLE_ASSET.id];
    expect(runtimeAfterSell.availableUnits).toBe(93);
    expect(runtimeAfterSell.yourUnits).toBe(7);
    expect(runtimeAfterSell.realizedProfitGBP).toBeGreaterThan(0);

    const ledger = useStore.getState().marketLedger;
    expect(ledger).toHaveLength(2);
    expect(ledger[0].action).toBe('sell-units');
    expect(ledger[0].referenceId).toBe(SAMPLE_ASSET.id);
    expect(ledger[1].action).toBe('buy-units');
    expect(ledger[1].referenceId).toBe(SAMPLE_ASSET.id);
  });

  it('blocks trading when compliance is incomplete', () => {
    useStore.getState().updateSyndicateCompliance({
      kycVerified: false,
    });

    const result = useStore.getState().buySyndicateUnits(SAMPLE_ASSET, 'u_buyer', 2);
    expect(result.ok).toBe(false);
    expect(result.message?.toLowerCase()).toContain('kyc');
  });
});
