import type { RootStackParamList } from '../navigation/types';
import { sanitizeDecimalInput, sanitizeIntegerInput } from './currencyAuthoringFlows';

type CreateCoOwnPrefill = NonNullable<RootStackParamList['CreateCoOwn']>;

interface BuildCoOwnPrefillInput {
  listingId?: string;
  shareCountInput: string;
  sharePriceInput: string;
  offeringWindowHours: number;
  authPhotos: string[];
}

interface BuildCoOwnPrefillResult {
  ok: boolean;
  params?: CreateCoOwnPrefill;
  error?: string;
}

export function buildCreateCoOwnPrefillFromSell(
  input: BuildCoOwnPrefillInput
): BuildCoOwnPrefillResult {
  const totalUnits = Number(sanitizeIntegerInput(input.shareCountInput));
  if (!Number.isFinite(totalUnits) || totalUnits < 1 || totalUnits > 20) {
    return {
      ok: false,
      error: 'Co-Own share count must be between 1 and 20.',
    };
  }

  const unitPriceDisplay = Number(sanitizeDecimalInput(input.sharePriceInput));
  if (!Number.isFinite(unitPriceDisplay) || unitPriceDisplay <= 0) {
    return {
      ok: false,
      error: 'Enter a valid share price for your co-own.',
    };
  }

  if (input.authPhotos.length === 0) {
    return {
      ok: false,
      error: 'Attach at least one authentication photo for the co-own flow.',
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

export function getCreateCoOwnInitialState(
  prefill: RootStackParamList['CreateCoOwn'],
  defaultListingId: string
) {
  const selectedListingId = prefill?.listingId ?? defaultListingId;
  const requestedUnits = Number(prefill?.totalUnits);
  const normalizedUnits = Number.isFinite(requestedUnits)
    ? Math.min(20, Math.max(1, Math.floor(requestedUnits)))
    : 20;
  const totalUnitsInput = String(normalizedUnits);
  const unitPriceInput = Number.isFinite(prefill?.unitPriceDisplay)
    ? Number(prefill?.unitPriceDisplay).toFixed(2)
    : '1.00';

  return {
    selectedListingId,
    totalUnitsInput,
    unitPriceInput,
  };
}
