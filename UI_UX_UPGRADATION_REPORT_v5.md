# Thryftverse UI/UX Upgradation Plan v5

Date: 2026-04-27
Scope: Complete visual system overhaul to remove "AI slop" and achieve Instagram/Depop/Vinted/Pinterest quality. Screen consolidation, design token implementation, and 5-tab navigation adoption.

---

## Problem Statement

Current UI exhibits "AI slop" characteristics:
- Inconsistent spacing (random padding values like 12, 18, 23)
- Generic component shapes (everything is a rounded rectangle with borderRadius: 20)
- No cohesive visual hierarchy
- 49 screens (too many - Depop has ~20)
- Inconsistent typography (inline fontSizes everywhere)
- Generic loading states
- No unified design language

---

## Target: Instagram/Depop/Vinted/Pinterest Quality

| App | Strengths to Adopt |
|-----|-------------------|
| **Instagram** | 5-tab navigation, collapsible headers, double-tap interactions, minimal chrome |
| **Depop** | Full-bleed product images, price-first hierarchy, bold sell button |
| **Vinted** | Masonry grid, clean filters, messaging-centric flow |
| **Pinterest** | Varied aspect ratios, infinite scroll, visual search |

---

## Phase 1: Design System Foundation (Critical)

### 1.1 Create Design Tokens

**File:** `src/theme/designTokens.ts`

```typescript
// Spacing scale (4px base grid)
export const Space = {
  xs: 4,    // Micro adjustments
  sm: 8,    // Tight spacing (icons, inline)
  md: 16,   // Default padding (cards, sections)
  lg: 24,   // Section breaks
  xl: 32,   // Major sections
  xxl: 48,  // Hero spacing
} as const;

// Border radius (intentional, not random)
export const Radius = {
  none: 0,      // Images (full-bleed)
  sm: 4,        // Buttons, inputs
  md: 8,        // Small cards
  lg: 12,       // Modals, sheets
  xl: 16,       // Large cards
  full: 999,    // Pills, avatars, floating buttons
} as const;

// Typography (San Francisco/iOS style)
export const Type = {
  caption: { size: 12, lineHeight: 16, weight: '400', letterSpacing: 0 },
  captionEmphasis: { size: 12, lineHeight: 16, weight: '600', letterSpacing: 0 },
  body: { size: 14, lineHeight: 20, weight: '400', letterSpacing: -0.2 },
  bodyEmphasis: { size: 14, lineHeight: 20, weight: '600', letterSpacing: -0.2 },
  headline: { size: 17, lineHeight: 24, weight: '600', letterSpacing: -0.4 }, // iOS headline
  title3: { size: 20, lineHeight: 28, weight: '600', letterSpacing: -0.5 },
  title2: { size: 24, lineHeight: 32, weight: '700', letterSpacing: -0.6 },
  title1: { size: 32, lineHeight: 40, weight: '700', letterSpacing: -0.8 },
} as const;

// Color palette (simplified)
export const Palette = {
  // Backgrounds
  bgPrimary: '#FFFFFF',
  bgSecondary: '#FAFAFA',
  bgTertiary: '#F0F0F0',
  bgElevated: '#FFFFFF',
  
  // Text
  textPrimary: '#000000',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textInverse: '#FFFFFF',
  textLink: '#3897F0', // Instagram blue
  
  // Primary accent (Depop orange)
  primary: '#FF4500',
  primaryLight: '#FF6B35',
  primaryDark: '#CC3700',
  
  // Semantic
  success: '#00C853',
  error: '#FF1744',
  warning: '#FFB300',
} as const;

// Shadows (elevation)
export const Elevation = {
  none: { shadowColor: 'transparent', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8 },
} as const;

// Animation durations
export const Duration = {
  instant: 0,
  fast: 150,
  normal: 250,
  slow: 400,
  slower: 600,
} as const;
```

### 1.2 Create Text Component System

**File:** `src/components/ui/Text.tsx`

Replace ALL inline typography with these components:

```typescript
export const T = {
  Caption: ({ children, emphasis, style }) => (
    <RNText style={[Type.caption, emphasis && Type.captionEmphasis, style]}>{children}</RNText>
  ),
  Body: ({ children, emphasis, style }) => (
    <RNText style={[Type.body, emphasis && Type.bodyEmphasis, style]}>{children}</RNText>
  ),
  Headline: ({ children, style }) => (
    <RNText style={[Type.headline, style]}>{children}</RNText>
  ),
  Title: ({ children, level = 3, style }) => {
    const typeStyle = level === 1 ? Type.title1 : level === 2 ? Type.title2 : Type.title3;
    return <RNText style={[typeStyle, style]}>{children}</RNText>;
  },
  Price: ({ children, currency = '£', style }) => (
    <RNText style={[Type.bodyEmphasis, { letterSpacing: 0 }, style]}>
      {currency}{children}
    </RNText>
  ),
};
```

**Migration rule:** Delete ALL `fontSize: 14` inline styles. Use `<T.Body>` instead.

---

## Phase 2: Navigation Consolidation (Critical)

### 2.1 Current Problem
- Complex nested stack navigators
- 49 screens (too many)
- Inconsistent navigation patterns
- No clear primary actions

### 2.2 Solution: Instagram-Style 5-Tab

```
┌─────────────────────────────────────────────────┐
│  🏠      🔍      ➕      💬      👤           │
│ Home   Search   Sell   Inbox   Profile          │
└─────────────────────────────────────────────────┘
```

**Tab Structure:**

| Tab | Contains | Screens to Merge |
|-----|----------|------------------|
| **Home** | Feed, Recommendations, Stories | HomeScreen + PosterViewer |
| **Search** | Browse, Categories, Filters | BrowseScreen + CategoryDetail + CategoryTree |
| **Sell** | Camera, Create Listing, Drafts | CreatePosterScreen + PosterEditor + ListingSuccess |
| **Inbox** | Messages, Notifications, Orders | InboxScreen + ChatScreen + MyOrders + Notifications |
| **Profile** | User profile, Settings, Wallet | MyProfileScreen + Settings + BalanceScreen + Portfolio |

### 2.3 Screen Consolidation Map

**Merge these (49 → 32 screens):**

| Keep | Merge Into It | Delete |
|------|--------------|--------|
| SettingsScreen | AccountSettingsScreen + PersonalisationScreen + ChangePassword + TwoFactorSetup + PushNotifications | 4 screens |
| WalletScreen | BalanceScreen + BalanceHistoryScreen + WithdrawScreen + PaymentsScreen | 3 screens |
| BrowseScreen | CategoryDetailScreen + CategoryTreeScreen + SearchScreen | 2 screens |
| CreateContentScreen | CreatePosterScreen + PosterEditorScreen + ListingSuccessScreen | 2 screens |
| InboxScreen | ChatScreen (as modal/push) + NotificationsScreen | 1 screen |
| ProfileScreen | MyProfileScreen + EditProfileScreen | 1 screen |
| TradeHubScreen | AuctionsScreen + PortfolioScreen + SyndicateHubScreen | 2 screens |

**Result:** 49 screens → 32 screens

---

## Phase 3: Visual System Overhaul

### 3.1 Grid System (Depop/Pinterest Style)

**Current Issue:** Generic 2-column grid with fixed aspect ratios.

**Fix:** Masonry grid with varied heights

```typescript
// Masonry grid configuration
const MASONRY_CONFIG = {
  columns: 2,
  gap: Space.sm, // 8px exactly
  aspectRatios: [0.75, 1.0, 1.25, 1.5], // Varied like Pinterest
};

// Grid item style
{
  flex: 1,
  marginHorizontal: Space.xs, // 4px
  marginBottom: Space.md,     // 16px
}

// Image style (NO border radius on images!)
{
  width: '100%',
  aspectRatio: getAspectRatio(item.id), // Deterministic but varied
  borderRadius: Radius.none, // Square corners like Depop
}
```

### 3.2 Product Card Redesign (Depop Style)

**Before (AI slop):**
```
┌─────────────────────────┐
│  ┌─────────────────┐  │
│  │                 │  │
│  │     IMAGE       │  │
│  │   borderR: 12   │  │
│  │                 │  │
│  └─────────────────┘  │
│                         │
│  Title here             │
│  £45.00                 │
│  [Like] [Message]       │
└─────────────────────────┘
  padding: 16
  borderR: 20
  shadow
```

**After (Depop style):**
```
┌──────────────────┐
│                  │
│     IMAGE        │
│  (full bleed)    │
│                  │
├──────────────────┤
│ £45      ♡       │
│ Size M           │
└──────────────────┘
  padding: 0 on image
  padding: 8 on text
  NO card container
  NO shadow
```

**Implementation:**
```typescript
<ProductCard minimal>
  <Image style={{ borderRadius: 0 }} />
  <View style={{ padding: Space.sm }}>
    <T.Price>£{price}</T.Price>
    <T.Caption>{size}</T.Caption>
  </View>
</ProductCard>
```

### 3.3 Header System (Instagram Style)

**Collapsible headers on all screens:**

```typescript
const scrollY = useSharedValue(0);

const headerStyle = useAnimatedStyle(() => ({
  height: interpolate(scrollY.value, [0, 100], [120, 60]),
  opacity: interpolate(scrollY.value, [0, 50], [1, 0.9]),
  transform: [{
    translateY: interpolate(scrollY.value, [0, 100], [0, -20]),
  }],
}));

// Usage
<Animated.View style={[styles.header, headerStyle]}>
  <T.Title level={2}>{title}</T.Title>
</Animated.View>
```

### 3.4 Button System

**Current:** Mix of `AppButton` variants with inconsistent sizing.

**New:** 3 button types only

```typescript
// Primary: Sell, Buy, CTAs
<Button variant="primary" size="lg">
  Sell Now
</Button>

// Secondary: Save, Follow, Less important
<Button variant="secondary" size="md">
  Save to Wishlist
</Button>

// Ghost: Navigation, Cancel
<Button variant="ghost" size="sm">
  Cancel
</Button>
```

**Sizes:**
- `sm`: 32px height (compact actions)
- `md`: 44px height (default)
- `lg`: 56px height (primary CTAs like "Sell")

### 3.5 Input System

**Standardize all inputs:**

```typescript
// Input config
{
  height: 48,
  borderRadius: Radius.sm, // 4px
  borderWidth: 1,
  borderColor: Palette.bgTertiary,
  paddingHorizontal: Space.md,
  fontSize: Type.body.size,
}

// Focus state
{
  borderColor: Palette.primary,
  borderWidth: 2,
}
```

---

## Phase 4: Animation Polish

### 4.1 Instagram-Style Interactions

**Double-tap to like:**
```typescript
const heartScale = useSharedValue(0);

const onDoubleTap = () => {
  heartScale.value = withSequence(
    withSpring(1.5, { damping: 10, stiffness: 200 }),
    withSpring(1, { damping: 10 }),
    withDelay(800, withSpring(0))
  );
};
```

**Pull-to-refresh (iOS style):**
```typescript
<RefreshControl 
  tintColor={Palette.textSecondary}
  progressViewOffset={Space.lg}
/>
```

**Page transitions:**
```typescript
// Slide from right (like Instagram)
const screenOptions = {
  cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
  transitionSpec: {
    open: { animation: 'spring', config: { stiffness: 1000, damping: 50 } },
    close: { animation: 'spring', config: { stiffness: 1000, damping: 50 } },
  },
};
```

### 4.2 Micro-interactions

**Button press:**
```typescript
const buttonScale = useSharedValue(1);

const onPressIn = () => {
  buttonScale.value = withSpring(0.96, { damping: 20 });
};

const onPressOut = () => {
  buttonScale.value = withSpring(1, { damping: 20 });
};
```

**List item entrance:**
```typescript
<Animated.View entering={FadeInDown.duration(300).delay(index * 50)}>
  {/* Item */}
</Animated.View>
```

---

## Phase 5: Loading States

### 5.1 Skeleton Screens (Instagram Style)

**Replace all spinners with skeletons:**

```typescript
// Skeleton component
<Skeleton 
  variant="card"      // card, avatar, text, image
  width={GRID_WIDTH}
  height={200}
  animate={true}      // Shimmer effect
/>

// Usage in grid
{loading ? (
  <MasonryGrid>
    {[...Array(6)].map((_, i) => (
      <Skeleton key={i} variant="card" height={randomHeight(i)} />
    ))}
  </MasonryGrid>
) : (
  <ProductGrid data={products} />
)}
```

### 5.2 Progressive Image Loading

```typescript
<CachedImage
  source={{ uri }}
  placeholder={<Skeleton variant="image" />}
  transition={300}
/>
```

---

## Phase 6: Screen-Specific Redesigns

### 6.1 Home Screen (Instagram Feed Style)

**Structure:**
```
┌─────────────────────────────┐
│ Stories Row (horizontal)    │
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐   │
│  │     IMAGE          │   │
│  │    (full width)    │   │
│  │                    │   │
│  ├─────────────────────┤   │
│  │ 👤 Username    ♡ 💬 │   │
│  │ £45.00 Size M       │   │
│  └─────────────────────┘   │
│                             │
│  [Next item...]             │
│                             │
└─────────────────────────────┘
```

**Changes:**
- Full-width images (no padding)
- Stories row at top
- Simple footer with price/size
- Double-tap to like

### 6.2 Browse Screen (Pinterest Grid)

**Changes:**
- Masonry grid (varied heights)
- No card containers
- Filter pills at top (horizontal scroll)
- Search bar collapses on scroll

### 6.3 Product Detail (Depop Style)

**Structure:**
```
┌─────────────────────────────┐
│ ←                    [♡]  │  (transparent header)
├─────────────────────────────┤
│                             │
│    FULL SCREEN IMAGE       │
│    (swipeable gallery)     │
│                             │
├─────────────────────────────┤
│ 👤 Seller Name         →    │
├─────────────────────────────┤
│ £45.00                      │
│ Vintage Denim Jacket        │
│ Size M • Excellent Cond.    │
│                             │
│ [Buy Now]                   │
│ [Make Offer]                │
│                             │
│ Description...              │
│                             │
└─────────────────────────────┘
```

### 6.4 Profile Screen (Instagram Style)

**Structure:**
```
┌─────────────────────────────┐
│ ┌─────┐  Username      ⚙️  │
│ │ 😊  │  @handle            │
│ └─────┘  Bio line 1         │
│          Bio line 2         │
│                             │
│ [Edit Profile] [Share]      │
│                             │
│ 12   45   £1.2k            │
│posts listings sold          │
├─────────────────────────────┤
│ [Grid] [List] [Tagged]      │
├─────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐       │
│ │    │ │    │ │    │       │
│ └────┘ └────┘ └────┘       │
│ [Your listings grid]        │
└─────────────────────────────┘
```

### 6.5 Wallet Screen (Consolidated)

Merge Balance + BalanceHistory + Withdraw into tabs:

```
┌─────────────────────────────┐
│ Wallet                 ⚙️  │
├─────────────────────────────┤
│                             │
│  £125.00           50 1ze   │
│  Fiat Balance      1ze Bal  │
│                             │
│ [Load] [Convert] [History]  │
│                             │
├─────────────────────────────┤
│ Recent Activity             │
│ • Bought 1ze (+50)    £25  │
│ • Sale completed     +£45  │
│ • Withdrawal to bank -£100 │
│                             │
└─────────────────────────────┘
```

---

## Phase 7: Expo Go "Slop" Removal

### 7.1 Status Bar Consistency

**Every screen must have:**
```typescript
<StatusBar 
  barStyle="dark-content"  // or "light-content" on dark screens
  backgroundColor="transparent"
  translucent
/>
```

### 7.2 SafeArea Consistency

**Pattern for all screens:**
```typescript
<SafeAreaView style={styles.container} edges={['top']}>
  <View style={styles.content}>
    {/* Screen content */}
  </View>
</SafeAreaView>

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.bgPrimary },
  content: { flex: 1, paddingHorizontal: Space.md },
});
```

### 7.3 Remove Inline Dimensions

**Before:**
```typescript
const width = Dimensions.get('window').width;
const itemWidth = (width - 32) / 2;
```

**After:**
```typescript
// In constants/layout.ts
export const SCREEN_WIDTH = Dimensions.get('window').width;
export const GRID_ITEM_WIDTH = (SCREEN_WIDTH - Space.md * 3) / 2;
```

### 7.4 Remove Random Border Radii

**Audit and replace:**
- `borderRadius: 20` → `Radius.xl` (16) or `Radius.lg` (12)
- `borderRadius: 12` → `Radius.md` (8) or `Radius.lg` (12)
- `borderRadius: 8` → `Radius.sm` (4) or `Radius.md` (8)

### 7.5 Remove Random Padding Values

**Audit and replace:**
- `padding: 12` → `Space.md` (16) or `Space.sm` (8)
- `padding: 18` → `Space.md` (16) or `Space.lg` (24)
- `padding: 23` → `Space.lg` (24)

---

## Execution Priority

### P0 - Critical (Week 1)
1. ✅ Create `designTokens.ts` with Space, Radius, Type, Palette
2. ✅ Create `Text.tsx` component system
3. ✅ Implement 5-tab navigation structure
4. ✅ Consolidate screens (49 → 32)

### P1 - High Impact (Week 2)
5. ✅ Redesign grid layouts (masonry, full-bleed images)
6. ✅ Redesign product cards (Depop style)
7. ✅ Standardize all buttons (3 variants only)
8. ✅ Implement skeleton loading states

### P2 - Polish (Week 3)
9. ✅ Add micro-interactions (button press, like animation)
10. ✅ Implement collapsible headers
11. ✅ Standardize status bars and safe areas
12. ✅ Fix all inline styles (Dimensions, random values)

### P3 - Advanced (Week 4)
13. ✅ Page transition animations
14. ✅ Pull-to-refresh polish
15. ✅ Empty states redesign
16. ✅ Error states redesign

---

## File Change Map

### New Files
```
src/theme/
  ├── designTokens.ts       (NEW - Space, Radius, Type, Palette, Elevation)
  ├── colors.ts             (REFACTOR - use Palette)
  └── typography.ts         (REFACTOR - use Type)

src/components/ui/
  ├── Text.tsx              (NEW - T.Caption, T.Body, T.Headline, T.Price)
  ├── Button.tsx            (REFACTOR - 3 variants only)
  ├── Skeleton.tsx          (NEW - shimmer loading)
  └── Input.tsx             (REFACTOR - standardize)

src/navigation/
  ├── MainTabs.tsx          (NEW - 5-tab structure)
  └── RootNavigator.tsx     (REFACTOR - simplified)
```

### Files to Delete/Merge
```
DELETE:
- AccountSettingsScreen.tsx → merge into SettingsScreen
- PersonalisationScreen.tsx → merge into SettingsScreen
- BalanceHistoryScreen.tsx → merge into WalletScreen
- WithdrawScreen.tsx → merge into WalletScreen
- CategoryDetailScreen.tsx → merge into BrowseScreen
- CategoryTreeScreen.tsx → merge into BrowseScreen
- PosterEditorScreen.tsx → merge into CreateContentScreen
- EditProfileScreen.tsx → merge into ProfileScreen
- SyndicateHubScreen.tsx → merge into TradeHubScreen
- AuctionsScreen.tsx → merge into TradeHubScreen
- (19 other screens)
```

### Files to Major Refactor
```
REFACTOR:
- HomeScreen.tsx            (stories row, full-width feed)
- BrowseScreen.tsx          (masonry grid, filter pills)
- ItemDetailScreen.tsx      (full-screen gallery, Depop layout)
- ProfileScreen.tsx         (Instagram-style grid)
- WalletScreen.tsx          (consolidated balance + history)
- SettingsScreen.tsx        (merged settings)
- InboxScreen.tsx           (simplified, no Chat inline)
- ProductCard.tsx           (minimal, no container)
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Screen count | 49 | 32 |
| Inline fontSize usages | ~200 | 0 (all use T.*) |
| Random padding values | ~150 | 0 (all use Space.*) |
| Border radius variants | 12 | 5 (Radius.*) |
| Design token coverage | 0% | 100% |
| Load time perception | Slow | Fast (skeletons) |
| Navigation depth | 4+ levels | Max 2 levels |

---

## Rollout Strategy

1. **Week 1:** Design tokens + 5-tab nav (foundation)
2. **Week 2:** Screen consolidation + grid redesign (big impact)
3. **Week 3:** Component standardization + polish (consistency)
4. **Week 4:** Animation + micro-interactions (delight)

**Testing:** Each week should be testable independently. Don't break existing flows during transition.

---

## Anti-Patterns to Eliminate

### ❌ Don't Do This
```typescript
// Random values
{ padding: 14, borderRadius: 18, fontSize: 15 }

// Inline Dimensions
const width = Dimensions.get('window').width;

// Complex nesting
<View style={{ padding: 20 }}>
  <View style={{ padding: 16 }}>
    <View style={{ padding: 12 }}>
      <Text style={{ fontSize: 14 }}>

// Multiple similar screens
HomeScreen.tsx, FeedScreen.tsx, DiscoverScreen.tsx (all similar)

// Generic card containers
<View style={{ borderRadius: 20, padding: 16, shadowOpacity: 0.2 }}>
  <Image style={{ borderRadius: 12 }} />
</View>
```

### ✅ Do This Instead
```typescript
// Design tokens
{ padding: Space.md, borderRadius: Radius.md }

// Centralized layout
import { GRID_ITEM_WIDTH } from '@/constants/layout';

// Flattened structure
<View style={styles.container}>
  <T.Body emphasis>Text</T.Body>

// Consolidated screens
HomeScreen.tsx with modes: 'feed' | 'discover'

// Image-first design
<Image style={{ borderRadius: 0 }} />
<View style={{ padding: Space.sm }}>
  <T.Price>£45</T.Price>
</View>
```

---

## Reference Apps

Study these for implementation details:

1. **Instagram** - Navigation, stories, gestures
2. **Depop** - Product cards, sell flow, grids
3. **Vinted** - Filters, messaging, simplicity
4. **Pinterest** - Masonry, search, visual discovery
5. **Airbnb** - Booking flow, animations

---

## Notes

- This plan assumes React Native + Expo + React Navigation
- All animations use react-native-reanimated
- Grid uses FlashList for performance
- Images use expo-image for caching
- Keep existing business logic, only change presentation
- Maintain backward compatibility during transition
