export interface PayoutSettlementBreakdownInput {
  amountGbp: number;
  networkFeeGbp?: number;
  spreadGbp?: number;
}

export interface PayoutSettlementBreakdown {
  amountGbp: number;
  networkFeeGbp: number;
  spreadGbp: number;
  totalPlatformDeductionGbp: number;
  netPayoutGbp: number;
  isValid: boolean;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeMoney(value: number | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return roundTo(Math.max(0, parsed), 2);
}

export function computePayoutSettlementBreakdown(
  input: PayoutSettlementBreakdownInput
): PayoutSettlementBreakdown {
  const amountGbp = normalizeMoney(input.amountGbp);
  const networkFeeGbp = normalizeMoney(input.networkFeeGbp);
  const spreadGbp = normalizeMoney(input.spreadGbp);
  const totalPlatformDeductionGbp = roundTo(networkFeeGbp + spreadGbp, 2);
  const netPayoutGbp = roundTo(Math.max(0, amountGbp - totalPlatformDeductionGbp), 2);

  return {
    amountGbp,
    networkFeeGbp,
    spreadGbp,
    totalPlatformDeductionGbp,
    netPayoutGbp,
    isValid: totalPlatformDeductionGbp <= amountGbp + 1e-6,
  };
}
