# UI/UX Polish Planning Document

## Overview
Comprehensive UI/UX cleanup across the Thryftverse app to remove unnecessary elements, fix layout issues, and improve overall user experience.

---

## 1. Upload Screen Cleanup
**File:** `src/screens/UploadScreen.tsx`

### Tasks:
- [ ] Remove "Publish Readiness" text/writing
- [ ] Remove "4 Required Checks Left" indicator
- [ ] Remove any related "Region" selector if present

### Reasoning:
These elements clutter the UI and create unnecessary anxiety for users during the upload process.

---

## 2. Discover Page Render Error Fix
**File:** `src/screens/GlobalSearchScreen.tsx` or `src/screens/SearchScreen.tsx`

### Tasks:
- [ ] Identify root cause of render error
- [ ] Fix color token issues (accent→brand, textInverse→background)
- [ ] Fix any missing imports

### Investigation Notes:
- Check for deprecated `Colors.accent` and `Colors.textInverse` references
- Verify component imports are correct

---

## 3. Auctions Screen Cleanup
**File:** `src/screens/AuctionScreen.tsx`

### Tasks:
- [ ] Remove the larger, non-functional "My Auctions" button (bottom one)
- [ ] Keep only the functional top navigation
- [ ] Remove "Active", "Upcoming", and "Bids" tabs from this screen
- [ ] Add "My Bids" button with proper navigation

### Co-own Exclusivity:
- "My Auctions", "My Open Pools", "Co-own Value" should ONLY appear on Co-own page
- Remove from all other screens

---

## 4. Remove Support/Message Buttons
**Files to Check:**
- `src/screens/AuctionScreen.tsx`
- `src/screens/CoOwnScreen.tsx`
- `src/screens/PoolDetailsScreen.tsx`
- Other screens with "Support @marifulllery"

### Tasks:
- [ ] Remove "Support @marifulllery" buttons
- [ ] Remove "Message" buttons where unnecessary
- [ ] Search entire codebase for these patterns and remove

---

## 5. TPP Profile Screen Button Fix
**File:** `src/screens/UserProfileScreen.tsx`

### Tasks:
- [ ] Fix "Listings", "Reviews", "About" buttons - make smaller
- [ ] Fix broken text/writing in these buttons
- [ ] Ensure proper alignment and spacing

### Pattern to Fix:
Buttons are currently oversized with text overflow/breaking issues.

---

## 6. Fix Same Pattern in Other Screens
**Files to Check:**
- `src/screens/CreateCoOwnScreen.tsx`
- `src/screens/PromoteDropScreen.tsx`
- Any other screens with oversized/broken buttons

### Tasks:
- [ ] Apply same button sizing fixes
- [ ] Ensure text doesn't break/overflow

---

## 7. Inbox/New Group Button Fix
**File:** `src/screens/InboxScreen.tsx`

### Tasks:
- [ ] Fix "New Group" button alignment (outside layout issue)
- [ ] Improve visual styling
- [ ] Ensure it stays within container bounds

---

## 8. Product Screen Layout
**File:** `src/screens/ProductScreen.tsx`

### Tasks:
- [ ] Move user profile section to TOP of screen
- [ ] Align price and product details properly
- [ ] Make layout neat and organized

---

## 9. Clean Up Unnecessary Text
**Files to Check:**
- `src/screens/ProductScreen.tsx` ("Buy Now", "Make Offer")
- Chat screen ("Instant Checkout", "Negotiate")

### Tasks:
- [ ] Remove "Instant Checkout" text from buy flow
- [ ] Remove "Negotiate" text where not needed
- [ ] Clean up verbose descriptions throughout codebase

---

## Implementation Priority

### High Priority (Immediate):
1. Upload Screen - Remove publish readiness
2. Discover Page - Fix render error
3. Auctions - Remove non-functional button, add My Bids
4. Remove support/message buttons
5. TPP Profile - Fix oversized buttons
6. Product Screen - Profile at top

### Medium Priority:
7. Create Co-own/Promote Drop button fixes
8. New Group button alignment
9. Buy now/make offer text cleanup

---

## Color Token Reference
When fixing errors, use these mappings:
- `Colors.accent` → `Colors.brand`
- `Colors.textInverse` → `Colors.background`
- `Colors.card` → `Colors.surface`
- `Colors.cardAlt` → `Colors.background`

---

## Notes
- Search entire codebase for "marifulllery" and "support" patterns
- Test navigation after adding "My Bids" button
- Ensure all button text is readable and not truncated
- Maintain consistent spacing and padding
