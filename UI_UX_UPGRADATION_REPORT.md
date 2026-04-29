# Thryftverse UI/UX Upgradation Plan v5

Date: 2026-04-27
Scope: Complete visual system overhaul to remove "AI slop" and achieve Instagram/Depop/Vinted/Pinterst quality. Screen consolidation, design token implementation, and 5-tab navigation adoption.

## Product Direction (This Revision)

1. Keep only one settings entry in Profile.
2. Move seller identity and seller navigation to the very top of Chat.
3. Replace dedicated Profile button in Chat seller card with tap-on-identity behavior.
4. Position message filters (All, Offers, Updates) directly below the top identity layer.
5. Keep conversation search at Inbox level so users can search across threads (RAG-style retrieval path), not only inside one thread.
6. Apply similar interaction patterns to other high-traffic pages.

## Immediate Status

Completed now:
- Profile duplicate settings affordance has been consolidated.
- Implemented in src/screens/MyProfileScreen.tsx by removing the extra settings tile from quick access while preserving the primary settings action button.
- Chat seller identity now sits in the top rail with tap-to-profile, and the lower duplicate seller profile button has been removed.
- All/Offers/Updates is now positioned directly below the top chat rail.
- Chat thread-local search box has been removed from the conversation screen in favor of Inbox-level retrieval scope.
- Inbox search now evaluates conversations, participants, listing metadata, and message history, and passes query scope into Chat.
- Item Detail and Order Detail seller sections now use identity-first profile navigation with dedicated message CTA (no nested pressable conflicts).
- Order Detail messaging now routes with dynamic seller/listing conversation context instead of static thread id.
- Trade Hub mode switch (Auctions / Co-Own) now sits directly below the top header context for faster top-of-screen control access.
- My Orders cards now split actions cleanly: order summary opens details, while counterparty identity opens profile and a dedicated Message CTA opens chat.
- Browse listing cards now expose seller identity chips and direct message shortcuts without nesting actions inside the item-detail tap zone.
- Reusable ProductCard now supports optional seller identity navigation; Search and Favourites use it for direct profile access.
- Home feed masonry cards now separate primary listing-open tap from seller identity and message actions via a dedicated footer action row.
- Live auction cards now include direct seller profile and message actions while preserving bid and buy/watch controls.
- Global Search recommendation cards now include seller identity and message actions outside the main item-detail tap surface.
- Category Detail grid cards now split listing-open from seller profile and message actions in a non-nested card layout.
- Poster Viewer now uses a top identity rail with tap-to-profile and dedicated message action for poster creators.
- User Profile now exposes a dedicated message action for non-self profiles in the hero CTA rail.
- Notifications cards now separate primary destination open from actor profile and message actions using a non-nested action row.
- Asset Detail now includes issuer identity/profile and dedicated message action beneath asset meta.
- Chat routing now supports explicit partner identity fallback (`partnerUserId`) so direct message entries keep correct header identity even before thread hydration.
- My Profile hero identity block is now tappable to open the public-profile view, keeping profile navigation identity-first.
- Legacy static chat launches (Help & Support and Search look comments) now use partner-aware Chat params to preserve correct header identity.
- Create Group Chat member rows now split selection and profile navigation into distinct actions (no mixed-tap row behavior).
- Balance History now includes an explicit support identity + message action row for transaction issue escalation.
- Push Notifications now includes support identity/message actions for device-registration troubleshooting.
- Invite Friends now has true copy-to-clipboard behavior and referral support identity/message actions.
- Add Card now includes payment support identity + message quick actions for setup and policy issues.
- Add Bank Account now includes payment support identity + message quick actions for withdrawal-rail setup issues.
- Wallet experience now includes support identity + message quick actions in the underlying Balance screen implementation.
- Payments now includes support identity + message quick actions for cards/bank rails troubleshooting.
- Withdraw now includes payout support identity + message quick actions alongside bank-rail controls.
- Checkout item summary now provides explicit seller identity/profile and message actions separate from purchase actions.
- Add Address now includes delivery support identity + message quick actions during address setup.
- Filter sheet now includes explicit context identity and dedicated support message action in the top control layer.
- Success screen now includes post-checkout support identity + message quick actions.
- Manage Listing preview now includes explicit seller identity/profile and message actions.
- Category Tree now includes support identity/message actions and resilient prefix fallback handling.
- Listing Success now includes publishing support identity + message quick actions.
- Postage now includes support identity + message actions for carrier and shipping-option setup.
- Make Offer now includes explicit seller identity/profile and message actions in the offer context card.
- Create Poster now includes selected-listing seller identity/profile and message actions.
- Trade Hub now includes support identity + message actions in top context.
- Portfolio now includes support identity/message actions and per-holding issuer identity + message actions with split primary-vs-secondary tap zones.
- Co-Own Hub now includes support identity/message actions and per-asset issuer identity + message actions, with asset-open separated from Buy/Sell CTAs.
- Syndicate holdings screen now includes support identity/message actions and per-asset issuer identity + message actions with split primary card tap vs footer action controls.
- Co-Own order history now includes support identity/message actions and per-order issuer identity + message actions without nested pressables in row navigation.

Planned next:
- Continue applying the same identity-first and single-action CTA hierarchy to remaining high-traffic listing and feed surfaces.
- Add deeper retrieval ranking and result-group labels once backend semantic indexing is introduced.

## Current UX Baseline (Observed)

### Profile
- Settings appears in two places within the profile experience (action row and quick access grid), which creates affordance duplication.

### Chat
- Top header currently shows a static title or username and an info icon.
- Seller identity (name, region, last seen, profile button) appears lower in the contextual card stack.
- Message filters appear below thread-local utility search and cards.
- Thread search is scoped only to the active conversation.

### Inbox
- Inbox already has cross-thread keyword search input.
- Search can be upgraded from basic lexical matching to richer retrieval (message body, listing metadata, participants, and semantic hints).

## Target Interaction Architecture

### A. Chat Top Identity Rail (Primary)
- Place seller avatar, @username, location, and last-seen at the top-most chat rail.
- Make identity rail tappable to navigate to seller profile.
- Remove separate Profile button from lower seller card.
- Keep one optional right-side action icon for context actions (not duplicate profile navigation).

### B. Chat Secondary Controls
- Order directly below identity rail:
  1. All / Offers / Updates segmented control.
  2. Conversation summary card and tools toggle.
  3. Optional item context card (compact).
- Remove or demote thread-local search from this zone to reduce vertical clutter.

### C. Inbox Search as Retrieval Surface
- Promote Inbox search to global conversation retrieval entry point.
- Search should return:
  - conversation title or participant match,
  - message text snippets,
  - listing title or metadata match,
  - optional semantic nearest matches (RAG-ready).
- Tapping result deep-links to thread and scroll anchor where possible.

### D. Consistency Pattern for Other Pages
- Use tap-on-identity (name/avatar) as the primary profile navigation pattern.
- Avoid duplicate actions that perform same navigation.
- Keep filter controls near header context, not buried under unrelated cards.
- Favor one global search surface per domain (Inbox for conversations, Search tab for listings).

## Execution Plan

### Phase 1: Header and Navigation Cleanup (2-3 days)

1. Chat top rail redesign.
   - Move seller info block to header layer in src/screens/ChatScreen.tsx.
   - Convert username block into pressable navigation to UserProfile.
2. Remove redundant seller profile CTA.
   - Delete lower Profile button from seller bubble.
3. Reorder chat control stack.
   - Place AppSegmentControl (All/Offers/Updates) immediately under top identity rail.
4. Keep message timeline behavior unchanged.
   - Ensure no regression in offer actions, system updates, and message rendering.

Acceptance criteria:
- Seller profile is reachable by tapping identity at top.
- No duplicate profile navigation CTA in seller card.
- Filters appear above lower utility panels.

### Phase 2: Inbox Search Upgrade (3-4 days)

1. Retrieval model improvement in src/screens/InboxScreen.tsx.
   - Extend matching fields: participants, listings, messages, and metadata tags.
2. Search results behavior.
   - Keep current in-list filtering for quick mode.
   - Add expandable global matches grouping when query length is at least 2.
3. Navigation integration.
   - Deep-link into Chat with optional focus anchor.

Acceptance criteria:
- Users can locate relevant conversations without opening thread-by-thread.
- Search results include at least participant, listing, and message-context matches.

### Phase 3: Cross-Screen Pattern Adoption (4-5 days)

1. Profile and user pages.
   - Verify no duplicate settings or profile affordances.
2. Trade Hub and transactional surfaces.
   - Keep top context plus immediate filter controls model consistent.
3. Messaging-adjacent pages.
   - Align CTA hierarchy with one primary action and one secondary action maximum per section.

Acceptance criteria:
- Interaction model is consistent across Profile, Chat, Inbox, and Trade surfaces.
- Redundant navigation controls are removed in audited screens.

### Phase 4: QA, Accessibility, and Performance Guardrails (2 days)

1. Accessibility.
   - Add or verify accessibilityLabel, accessibilityHint, and role metadata for new pressable identity rails and filters.
2. Performance.
   - Re-check render cost after header restructuring and search enhancements.
3. UX polish.
   - Ensure spacing hierarchy remains stable on small devices and long usernames.

Acceptance criteria:
- No accessibility regressions on modified controls.
- No visible scroll or input lag introduced by retrieval enhancements.

## File-Level Change Map

Already updated:
- src/screens/MyProfileScreen.tsx
- src/screens/InboxScreen.tsx
- src/screens/ChatScreen.tsx
- src/screens/ItemDetailScreen.tsx
- src/screens/OrderDetailScreen.tsx
- src/screens/TradeHubScreen.tsx
- src/screens/MyOrdersScreen.tsx
- src/screens/BrowseScreen.tsx
- src/components/ProductCard.tsx
- src/screens/FavouritesScreen.tsx
- src/screens/SearchScreen.tsx
- src/screens/HomeScreen.tsx
- src/screens/AuctionsScreen.tsx
- src/screens/GlobalSearchScreen.tsx
- src/screens/CategoryDetailScreen.tsx
- src/screens/PosterViewerScreen.tsx
- src/screens/UserProfileScreen.tsx
- src/screens/NotificationsScreen.tsx
- src/screens/AssetDetailScreen.tsx
- src/screens/MyProfileScreen.tsx
- src/screens/HelpSupportScreen.tsx
- src/screens/CreateGroupChatScreen.tsx
- src/screens/BalanceHistoryScreen.tsx
- src/screens/PushNotificationsScreen.tsx
- src/screens/InviteFriendsScreen.tsx
- src/screens/AddCardScreen.tsx
- src/screens/AddBankAccountScreen.tsx
- src/screens/BalanceScreen.tsx
- src/screens/PaymentsScreen.tsx
- src/screens/WithdrawScreen.tsx
- src/screens/CheckoutScreen.tsx
- src/screens/AddAddressScreen.tsx
- src/screens/FilterScreen.tsx
- src/screens/SuccessScreen.tsx
- src/screens/ManageListingScreen.tsx
- src/screens/CategoryTreeScreen.tsx
- src/screens/ListingSuccessScreen.tsx
- src/screens/PostageScreen.tsx
- src/screens/MakeOfferScreen.tsx
- src/screens/CreatePosterScreen.tsx
- src/screens/TradeHubScreen.tsx
- src/screens/PortfolioScreen.tsx
- src/screens/SyndicateHubScreen.tsx
- src/screens/SyndicateScreen.tsx
- src/screens/SyndicateOrderHistoryScreen.tsx
- src/navigation/types.ts

Primary upcoming edits:
- src/screens/CreateSyndicateScreen.tsx
- src/screens/SyndicateOnboardingScreen.tsx

Possible support edits:
- src/navigation/types.ts (if search deep-link anchor params are added)
- src/store/useStore.ts (if retrieval metadata indexing is centralized)
- src/components/ui/AppSegmentControl.tsx (only if behavior extension is needed)

## UX Rules to Enforce Going Forward

1. One intent, one obvious action entry point.
2. Identity-first navigation in communication flows.
3. Keep controls close to their context layer.
4. Prefer global retrieval surfaces over duplicate local search bars.
5. Preserve existing design system primitives (AppInput, AppSegmentControl, AppButton) before adding bespoke controls.

## KPI Targets for This Revision

1. Duplicate settings or profile affordances in audited screens: 0.
2. Chat header path to seller profile: single-tap completion.
3. Inbox search success for known-thread queries: at least 90 percent in QA scenarios.
4. Decrease time-to-open-correct-thread for support-style tasks by at least 25 percent versus current baseline.

## Out of Scope for This Iteration

1. Backend semantic vector indexing service implementation.
2. Legal framework rollout for cross-country tokenized co-ownership.
3. Full redesign of non-messaging tabs unrelated to profile/chat/inbox hierarchy.

## Rollout Recommendation

1. Ship Phase 1 first (low-risk, high-clarity IA win).
2. Ship Phase 2 behind a feature flag for search quality validation.
3. Complete Phase 3 and Phase 4 with one UX regression pass before broad release.
