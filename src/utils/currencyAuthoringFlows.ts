import { SupportedCurrencyCode } from '../constants/currencies';
import { GoldRates, toFiat, toIze } from './currency';

const COMMERCE_PLATFORM_CHARGE_RATE = 0.05;
const COMMERCE_PLATFORM_CHARGE_FIXED_GBP = 0.7;
const COMMERCE_PLATFORM_CHARGE_MIN_RATE = 0.02;

export function sanitizeDecimalInput(rawValue: string): string {
  const normalized = rawValue.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = normalized.indexOf('.');

  if (firstDot === -1) {
    return normalized;
  }

  return normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, '');
}

export function sanitizeIntegerInput(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}

export function convertGbpToDisplayAmount(
  amountGbp: number,
  currencyCode: SupportedCurrencyCode,
  goldRates: Partial<GoldRates>
): number {
  if (currencyCode === 'GBP') {
    return amountGbp;
  }

  const amountIze = toIze(amountGbp, 'GBP', goldRates);
  return toFiat(amountIze, currencyCode, goldRates);
}

export function convertDisplayToGbpAmount(
  amountDisplay: number,
  currencyCode: SupportedCurrencyCode,
  goldRates: Partial<GoldRates>
): number {
  if (currencyCode === 'GBP') {
    return amountDisplay;
  }

  const amountIze = toIze(amountDisplay, currencyCode, goldRates);
  return toFiat(amountIze, 'GBP', goldRates);
}

export function calculatePlatformChargeGbp(subtotalGbp: number): number {
  const normalizedSubtotal = Number.isFinite(subtotalGbp) ? Math.max(0, subtotalGbp) : 0;
  const formulaCharge =
    normalizedSubtotal * COMMERCE_PLATFORM_CHARGE_RATE + COMMERCE_PLATFORM_CHARGE_FIXED_GBP;
  const minimumCharge = normalizedSubtotal * COMMERCE_PLATFORM_CHARGE_MIN_RATE;
  return Number(Math.max(formulaCharge, minimumCharge).toFixed(2));
}

export function getSuggestedBidDisplayAmount(
  currentBidGbp: number,
  currencyCode: SupportedCurrencyCode,
  goldRates: Partial<GoldRates>
): number {
  const minStep = Math.max(1, Number((currentBidGbp * 0.03).toFixed(2)));
  const suggestedBidGbp = Number((currentBidGbp + minStep).toFixed(2));
  const suggestedDisplay = convertGbpToDisplayAmount(suggestedBidGbp, currencyCode, goldRates);

  return Number.isFinite(suggestedDisplay)
    ? Number(suggestedDisplay.toFixed(2))
    : suggestedBidGbp;
}

export interface OfferSummary {
  offerGbp: number;
  platformChargeGbp: number;
  buyerProtectionFeeGbp: number;
  totalGbp: number;
}

export function calculateOfferSummaryFromDisplay(
  offerDisplay: number,
  currencyCode: SupportedCurrencyCode,
  goldRates: Partial<GoldRates>
): OfferSummary {
  const offerGbpRaw = convertDisplayToGbpAmount(offerDisplay, currencyCode, goldRates);
  const offerGbp = Number.isFinite(offerGbpRaw) && offerGbpRaw > 0 ? offerGbpRaw : 0;
  const platformChargeGbp = calculatePlatformChargeGbp(offerGbp);
  const totalGbp = Number((offerGbp + platformChargeGbp).toFixed(2));

  return {
    offerGbp,
    platformChargeGbp,
    buyerProtectionFeeGbp: platformChargeGbp,
    totalGbp,
  };
}

export function getDefaultWithdrawDisplayAmount(
  availableBalanceGbp: number,
  currencyCode: SupportedCurrencyCode,
  goldRates: Partial<GoldRates>
): number {
  const displayAmount = convertGbpToDisplayAmount(availableBalanceGbp, currencyCode, goldRates);

  return Number.isFinite(displayAmount)
    ? Number(displayAmount.toFixed(2))
    : Number(availableBalanceGbp.toFixed(2));
}
