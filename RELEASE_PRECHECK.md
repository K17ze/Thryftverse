# Thryftverse Release Precheck

Run this checklist before tagging a release or promoting a build.

## 0) Production Ship Checklist (Priority Order)

Ship blockers first, then polish, voice, performance, and accessibility.

### Ship-Blockers

- [ ] Remove `Math.random() - 0.5` sort in `HomeScreen.tsx` explore ordering and enforce stable server-ranked order.
- [ ] Replace `FEED_LOOKS` mock array with real backend endpoint (stubbed payload allowed, but API-backed).
- [ ] Crash telemetry live with self-hosted Sentry on Hetzner (no Sentry cloud).
- [ ] Image CDN warming and WebP/AVIF transforms for all product images via SeaweedFS.
- [ ] Offline mode: full read paths through AsyncStorage cache layer plus graceful write queueing.
- [ ] App Store / Play Store screenshots at 5 sizes using real Gen Z UGC (no stock assets).

### Visual Polish

- [ ] Collapsing header with `BlurView` on all 6 tab screens.
- [ ] Haptics on scroll-to-top, tab change, pull-refresh trigger, and swipe-between-images.
- [ ] Shared-element transition from feed card to `ItemDetail` hero image.
- [ ] Keyboard-aware scroll on all text inputs (not only Sell and Chat).
- [ ] Loading states for every async boundary with `SkeletonLoader`.
- [ ] Audit and close known loading gaps on AssetDetail, Portfolio, and MyOrders.
- [ ] Error boundary fallback UI is custom-designed (not default red screen).

### Gen Z Voice Pass

- [ ] Empty states rewritten with voice across 14 screens.
- [ ] Humanize error copy across ~40 Toast messages.
- [ ] Tab labels are lowercase.
- [ ] CTA audit: lowercase everywhere except primary headlines.
- [ ] Success screens include personality (Checkout success and Listing success).

### Performance (Flagship)

- [ ] Replace `FlatList` with `FlashList` on Home, Browse, and Search.
- [ ] Confirm `expo-image` on every image surface (no `react-native` Image usage on app surfaces).
- [ ] Prefetch next-page images when scroll passes 70% threshold.
- [ ] Memoize each list row component with `React.memo` and equality checks.
- [ ] Debounce search input to minimum 250ms.
- [ ] Cold start under 2s on mid-range Android (Pixel 6a or Samsung A54).

### Accessibility

- [ ] Add `accessibilityLabel` to every `Pressable`.
- [ ] Audit minimum 44x44 tap targets.
- [ ] Run WCAG AA contrast checks for all text/background combinations.
- [ ] Revisit dynamic type policy (`maxFontSizeMultiplier: 1.06` may be too restrictive).
- [ ] Screen reader flow testing on critical paths: auth, browse, checkout, 1ze load.

## 1) Automated Quality Gates

Run from the project root:

```bash
npm ci
npm run typecheck
npm run test
```

Optional diagnostics:

```bash
npm run doctor
npm run docker:check
```

Expected outcome:
- TypeScript passes with no errors.
- All Vitest suites pass.
- `expo doctor` reports no blocking issues.
- Local Docker backend passes end-to-end dependency checks (API, Postgres, Redis, MinIO, ML).

## 2) Core User-Flow Smoke

Validate these app flows in Expo Go or emulator:

- Auth: login, signup, forgot-password validation states.
- Browse/search: global search to browse results, filter apply/clear, wishlist add/remove.
- Checkout: add address, add card/bank account, pay button enabled only when requirements are met.
- Currency: switch local fiat currency and display mode; prices update across item detail, checkout, offers, wallet.
- Syndicate: create syndicate with compliance requirements, buy/sell units, order history updates.

## 3) Safety and Regression Checks

- Confirm no TypeScript suppression comments were introduced for new work.
- Confirm navigation routes added in `src/navigation/types.ts` are wired in `src/navigation/AppNavigator.tsx`.
- Confirm test coverage exists for new pure-flow utilities.

## 4) Release Notes Inputs

Capture the following for release notes:

- User-facing features and screen changes.
- New tests added and what behavior they protect.
- Any known limitations in prototype-only flows (for example, mocked trade execution).
