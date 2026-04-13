import { describe, expect, it } from 'vitest';
import { getI18nLocale, mapLanguageOptionToLocale, setI18nLocale, t } from '../i18n';

describe('i18n helper', () => {
  it('returns english strings for known keys', () => {
    setI18nLocale('en');

    expect(t('tradeHub.header.title')).toBe('Trade Hub');
    expect(t('tradeHub.tab.coOwn')).toBe('Co-Own');
  });

  it('interpolates template parameters', () => {
    const text = t('tradeHub.activity.bid', {
      amount: 'GBP 12.50',
      referenceId: 'asset_42',
    });

    expect(text).toBe('Bid GBP 12.50 on asset_42');
  });

  it('interpolates auctions-specific templates', () => {
    const bidMinText = t('auctions.bid.error.mustBeAbove', {
      amount: 'GBP 55.00',
    });
    const sellerText = t('auctions.seller.by', {
      seller: 'mariefullery',
    });

    expect(bidMinText).toBe('Bid must be above GBP 55.00');
    expect(sellerText).toBe('by mariefullery');
  });

  it('returns static auctions labels', () => {
    expect(t('auctions.header.myAuctions')).toBe('My Auctions');
    expect(t('auctions.cta.placeBid')).toBe('Place Bid');
    expect(t('auctions.empty.noActive')).toBe('No active auctions yet');
  });

  it('returns syndicate templates and labels', () => {
    const complianceSummary = t('syndicate.compliance.summary', {
      country: 'GB',
      kyc: 'on',
      disclosure: 'accepted',
    });

    expect(complianceSummary).toBe('Country GB · KYC on · Disclosure accepted.');
    expect(t('syndicate.header.myCoOwn')).toBe('My Co-Own');
    expect(t('syndicate.asset.pricePerUnit', { price: '1.00 1ze' })).toBe('1.00 1ze / unit');
  });

  it('returns settings and checkout templates and labels', () => {
    expect(t('settings.header.title')).toBe('Settings');
    expect(t('settings.push.subtitle', { enabled: 4, total: 7 })).toBe('4/7 types enabled');
    expect(t('checkout.payment.policyScope', { scope: 'GB-only' })).toBe('Policy scope: GB-only');
    expect(t('checkout.a11y.paySecurely', { amount: 'GBP 12.50' })).toBe('Pay GBP 12.50 securely');
  });

  it('maps settings language labels to supported locales', () => {
    expect(mapLanguageOptionToLocale('English (EN)')).toBe('en');
    expect(mapLanguageOptionToLocale('Spanish (ES)')).toBe('es');
    expect(mapLanguageOptionToLocale('French (FR)')).toBe('fr');
    expect(mapLanguageOptionToLocale('German (DE)')).toBe('de');
    expect(mapLanguageOptionToLocale('Unknown locale')).toBe('en');
  });

  it('allows switching active locale to non-english fallback dictionaries', () => {
    setI18nLocale('es');

    expect(getI18nLocale()).toBe('es');
    expect(t('settings.header.title')).toBe('Configuracion');
    expect(t('checkout.section.delivery')).toBe('Entrega');

    setI18nLocale('fr');
    expect(t('checkout.section.payment')).toBe('Paiement');

    setI18nLocale('de');
    expect(t('checkout.header.title')).toBe('Kasse');

    setI18nLocale('es');
    expect(t('tradeHub.header.title')).toBe('Trade Hub');
  });

  it('tracks the active locale', () => {
    setI18nLocale('en');

    expect(getI18nLocale()).toBe('en');
  });
});
