export interface PayoutProviderReferenceInput {
  targetStatus: string;
  transitionSource: string;
  inputProviderPayoutRef?: string | null;
  existingProviderPayoutRef?: string | null;
  fallbackProviderPayoutRef?: string | null;
}

export interface PayoutProviderReferenceResolution {
  providerPayoutRef: string | null;
  requiresProviderReference: boolean;
  isValid: boolean;
}

function normalizeProviderRef(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolvePayoutProviderReference(
  input: PayoutProviderReferenceInput
): PayoutProviderReferenceResolution {
  const existingProviderPayoutRef = normalizeProviderRef(input.existingProviderPayoutRef);

  if (input.targetStatus !== 'paid') {
    return {
      providerPayoutRef: existingProviderPayoutRef,
      requiresProviderReference: false,
      isValid: true,
    };
  }

  const inputProviderPayoutRef = normalizeProviderRef(input.inputProviderPayoutRef);
  const mergedProviderPayoutRef = inputProviderPayoutRef ?? existingProviderPayoutRef;

  const requiresProviderReference =
    input.transitionSource === 'provider_webhook'
    || input.transitionSource === 'mock_webhook'
    || input.transitionSource === 'admin_review';

  if (requiresProviderReference) {
    return {
      providerPayoutRef: mergedProviderPayoutRef,
      requiresProviderReference,
      isValid: mergedProviderPayoutRef !== null,
    };
  }

  return {
    providerPayoutRef:
      mergedProviderPayoutRef
      ?? normalizeProviderRef(input.fallbackProviderPayoutRef)
      ?? null,
    requiresProviderReference,
    isValid: true,
  };
}
