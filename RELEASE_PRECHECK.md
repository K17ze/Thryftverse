# Thryftverse Release Precheck

Run this checklist before tagging a release or promoting a build.

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
