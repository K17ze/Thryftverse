import type { RootStackParamList } from '../navigation/types';
import { sanitizeDecimalInput, sanitizeIntegerInput } from './currencyAuthoringFlows';

type CreateSyndicatePrefill = NonNullable<RootStackParamList['CreateSyndicate']>;

interface BuildSyndicatePrefillInput {
  listingId?: string;
  shareCountInput: string;
  sharePriceInput: string;
  offeringWindowHours: number;
  authPhotos: string[];
}

interface BuildSyndicatePrefillResult {
  ok: boolean;
  params?: CreateSyndicatePrefill;
  error?: string;
}

export function buildCreateSyndicatePrefillFromSell(
  input: BuildSyndicatePrefillInput
): BuildSyndicatePrefillResult {
  const totalUnits = Number(sanitizeIntegerInput(input.shareCountInput));
  if (!Number.isFinite(totalUnits) || totalUnits < 10) {
    return {
      ok: false,
      error: 'Syndicate share count must be at least 10.',
    };
  }

  const unitPriceDisplay = Number(sanitizeDecimalInput(input.sharePriceInput));
  if (!Number.isFinite(unitPriceDisplay) || unitPriceDisplay <= 0) {
    return {
      ok: false,
      error: 'Enter a valid share price for your syndicate.',
    };
  }

  if (input.authPhotos.length === 0) {
    return {
      ok: false,
      error: 'Attach at least one authentication photo for the syndicate flow.',
    };
  }

  return {
    ok: true,
    params: {
      listingId: input.listingId?.trim() || undefined,
      totalUnits,
      unitPriceDisplay,
      offeringWindowHours: input.offeringWindowHours,
      authPhotos: input.authPhotos,
    },
  };
}

export function getCreateSyndicateInitialState(
  prefill: RootStackParamList['CreateSyndicate'],
  defaultListingId: string
) {
  const selectedListingId = prefill?.listingId ?? defaultListingId;
  const totalUnitsInput = String(prefill?.totalUnits ?? 1000);
  const unitPriceInput = Number.isFinite(prefill?.unitPriceDisplay)
    ? Number(prefill?.unitPriceDisplay).toFixed(2)
    : '1.00';

  return {
    selectedListingId,
    totalUnitsInput,
    unitPriceInput,
  };
}
