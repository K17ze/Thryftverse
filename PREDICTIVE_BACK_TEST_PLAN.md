# Android Predictive Back Test Plan (Physical Device)

## Scope
Validate Android predictive back gesture behavior for primary journeys and modal flows on real devices running Android 14+.

## Required Devices
- At least one Pixel-class device on Android 14 or newer.
- One non-Pixel OEM device (Samsung/OnePlus/Xiaomi) on Android 14 if possible.

## Preconditions
- Install latest preview/release candidate build.
- Enable system predictive back animation in device developer options if required.
- Ensure app uses production-like navigation config.

## Test Matrix

1. Root Tab Navigation
- Steps: Open each main tab (Home, Search, TradeHub, Inbox, Profile), perform back gesture.
- Expected: Back exits app only from root destination; no unexpected tab jumps.

2. Stack Push/Pop
- Steps: Open ItemDetail from feed, then back gesture.
- Expected: Smooth preview animation and return to previous screen preserving scroll state.

3. Nested Trade Hub
- Steps: TradeHub -> Auctions -> ItemDetail / create flows -> back gesture repeatedly.
- Expected: Pops one screen at a time, no duplicate pops, no blank screens.

4. Modal and Composer Surfaces
- Steps: Open bid composer/order composer/modals, use back gesture.
- Expected: Modal closes first; does not pop underlying route.

5. Auth and Deep Link Entries
- Steps: Open app via deep link into chat or listing; back gesture.
- Expected: Returns to logical parent then exits; no dead-end routes.

6. Form Unsaved State
- Steps: CreateAuction/CreatePoster, edit fields, perform back gesture.
- Expected: Confirmation prompt (if implemented) or deterministic discard behavior.

7. Gesture Stress
- Steps: Rapid repeated back swipes across transitions.
- Expected: No crashes, no stuck transition, no gesture lock.

## Pass/Fail Criteria
- Pass when all flows have deterministic route outcomes and smooth predictive animation.
- Fail on any crash, route desync, visual flicker, double-pop, or data loss.

## Evidence To Capture
- Screen recording per failed case.
- Device model + Android version.
- Route path and exact gesture timing.
- Console logs if available.

## Defect Template
- Title: [PredictiveBack] <screen/flow> <symptom>
- Build: <version>
- Device: <model> / Android <version>
- Repro Steps: numbered list
- Expected: ...
- Actual: ...
- Attachment: video + logs

## Release Gate
Predictive back sign-off is mandatory before Android public rollout.
