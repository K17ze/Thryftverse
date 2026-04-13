import React from 'react';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { View, Text, StyleSheet, StatusBar, LayoutChangeEvent } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import AuctionsScreen from './AuctionsScreen';
import CoOwnScreen from './SyndicateScreen';
import { useStore } from '../store/useStore';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { t } from '../i18n';

type TradeHubTab = 'AUCTIONS' | 'CO-OWN';
type NavT = StackNavigationProp<RootStackParamList>;
const BRAND = Colors.accent;
const PANEL_TINT_BG = Colors.cardAlt;
const PANEL_BORDER = Colors.border;
const PANEL_BORDER_STRONG = Colors.borderLight;

export default function TradeHubScreen() {
  const navigation = useNavigation<NavT>();
  const { formatFromFiat } = useFormattedPrice();
  const [activeTab, setActiveTab] = React.useState<TradeHubTab>('AUCTIONS');
  const marketLedger = useStore((state) => state.marketLedger);
  const customAuctions = useStore((state) => state.customAuctions);
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);

  // ── Animated tab slider ──
  const tabLayouts = React.useRef<{ [key: string]: { x: number; width: number } }>({});
  const indicatorX = useSharedValue(4);
  const indicatorWidth = useSharedValue(0);

  const handleTabLayout = (tab: TradeHubTab, e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    tabLayouts.current[tab] = { x, width };
    if (tab === activeTab) {
      indicatorX.value = x;
      indicatorWidth.value = width;
    }
  };

  React.useEffect(() => {
    const layout = tabLayouts.current[activeTab];
    if (layout) {
      indicatorX.value = layout.x;
      indicatorWidth.value = layout.width;
    }
  }, [activeTab, indicatorX, indicatorWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: indicatorWidth.value,
  }));

  const latestActivity = marketLedger[0];

  const latestActivityText = React.useMemo(() => {
    if (!latestActivity) {
      return t('tradeHub.activity.empty');
    }
    if (latestActivity.channel === 'auction' && latestActivity.action === 'bid') {
      return t('tradeHub.activity.bid', {
        amount: formatFromFiat(latestActivity.amountGBP, 'GBP', { displayMode: 'fiat' }),
        referenceId: latestActivity.referenceId,
      });
    }
    if (latestActivity.channel === 'auction' && latestActivity.action === 'win') {
      return t('tradeHub.activity.win', {
        amount: formatFromFiat(latestActivity.amountGBP, 'GBP', { displayMode: 'fiat' }),
        referenceId: latestActivity.referenceId,
      });
    }
    if (latestActivity.channel === 'co-own' && latestActivity.action === 'sell-units') {
      const units = latestActivity.units ?? 0;
      return t('tradeHub.activity.soldUnits', {
        units,
        plural: units === 1 ? '' : 's',
        referenceId: latestActivity.referenceId,
      });
    }
    const units = latestActivity.units ?? 0;
    return t('tradeHub.activity.boughtUnits', {
      units,
      plural: units === 1 ? '' : 's',
      referenceId: latestActivity.referenceId,
    });
  }, [formatFromFiat, latestActivity]);

  const marketSnapshot = React.useMemo(() => {
    const nowTs = Date.now();

    const liveAuctions = customAuctions.filter((auction) => {
      const startsAtMs = new Date(auction.startsAt).getTime();
      const endsAtMs = new Date(auction.endsAt).getTime();
      return startsAtMs <= nowTs && endsAtMs > nowTs;
    }).length;

    const openPools = customCoOwns.filter((asset) => asset.isOpen).length;

    const holdingsValue = customCoOwns.reduce((sum, asset) => {
      const runtime = coOwnRuntime[asset.id];
      const units = runtime?.yourUnits ?? asset.yourUnits ?? 0;
      const unitPrice = runtime?.unitPriceGBP ?? asset.unitPriceGBP;
      return sum + units * unitPrice;
    }, 0);

    return {
      liveAuctions,
      openPools,
      holdingsValue,
    };
  }, [customAuctions, customCoOwns, coOwnRuntime]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.headerWrap}>
        <View>
          <View style={styles.titleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.headerTitle}>{t('tradeHub.header.title')}</Text>
            <Ionicons name="sparkles-outline" size={18} color={BRAND} />
          </View>
        </View>

        <AnimatedPressable
          style={styles.ledgerShortcutBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('MarketLedger')}
        >
          <Ionicons name="pulse-outline" size={15} color={BRAND} />
          <Text style={styles.ledgerShortcutText}>{t('tradeHub.ledger.label')}</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.snapshotCard}>
        <View style={styles.snapshotMetric}>
          <AnimatedCounter value={marketSnapshot.liveAuctions} style={styles.snapshotValue} duration={700} />
          <Text style={styles.snapshotLabel}>{t('tradeHub.snapshot.auctions')}</Text>
        </View>

        <View style={styles.snapshotDivider} />

        <View style={styles.snapshotMetric}>
          <AnimatedCounter value={marketSnapshot.openPools} style={styles.snapshotValue} duration={700} />
          <Text style={styles.snapshotLabel}>{t('tradeHub.snapshot.openPools')}</Text>
        </View>

        <View style={styles.snapshotDivider} />

        <View style={styles.snapshotMetricWide}>
          <Text style={styles.snapshotValueMoney} numberOfLines={1}>
            {formatFromFiat(marketSnapshot.holdingsValue, 'GBP', { displayMode: 'fiat' })}
          </Text>
          <Text style={styles.snapshotLabel}>{t('tradeHub.snapshot.coOwnValue')}</Text>
        </View>
      </View>

      {/* Animated tab switcher with sliding pill */}
      <View style={styles.tabSwitcher}>
        <Reanimated.View style={[styles.tabIndicator, indicatorStyle]} />
        {(['AUCTIONS', 'CO-OWN'] as const).map((tab) => (
          <AnimatedPressable
            key={tab}
            style={styles.tabBtn}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.9}
            onLayout={(e: LayoutChangeEvent) => handleTabLayout(tab, e)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'AUCTIONS' ? t('tradeHub.tab.auctions') : t('tradeHub.tab.coOwn')}
            </Text>
          </AnimatedPressable>
        ))}
      </View>

      <AnimatedPressable
        style={styles.activityCard}
        activeOpacity={0.92}
        onPress={() => navigation.navigate('MarketLedger')}
      >
        <View style={styles.activityTopRow}>
          <View style={styles.activityLabelRow}>
            <View style={styles.tapeDot} />
            <Text style={styles.activityLabel}>{t('tradeHub.activity.label')}</Text>
          </View>
          <View style={styles.activityRightWrap}>
            <AnimatedCounter
              value={marketLedger.length}
              style={styles.activityCount}
              duration={600}
              suffix={t('tradeHub.activity.eventsSuffix')}
            />
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </View>
        </View>
        <Text style={styles.activityText} numberOfLines={2}>{latestActivityText}</Text>
      </AnimatedPressable>

      <View style={styles.contentWrap}>
        {activeTab === 'AUCTIONS' ? <AuctionsScreen /> : <CoOwnScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  headerLabel: {
    color: BRAND,
    fontSize: 11,
    fontFamily: Typography.family.bold,
    letterSpacing: 1.3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 28,
    fontFamily: Typography.family.bold,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: Typography.family.medium,
  },
  ledgerShortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ledgerShortcutText: {
    color: BRAND,
    fontSize: 12,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  snapshotCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  snapshotMetric: {
    flex: 1,
    alignItems: 'center',
  },
  snapshotMetricWide: {
    flex: 1.3,
    alignItems: 'center',
  },
  snapshotDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: PANEL_BORDER,
    marginHorizontal: 8,
  },
  snapshotValue: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: Typography.family.bold,
  },
  snapshotValueMoney: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: Typography.family.bold,
    letterSpacing: -0.15,
  },
  snapshotLabel: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: Typography.family.medium,
    letterSpacing: 0.2,
  },

  // Animated tab switcher
  tabSwitcher: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: PANEL_TINT_BG,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
    padding: 4,
    flexDirection: 'row',
    gap: 6,
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 22,
    backgroundColor: Colors.accentGold,
    zIndex: 0,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 1,
  },
  tabText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },

  // Mode card
  modeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER_STRONG,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeCardText: {
    flex: 1,
    color: BRAND,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Typography.family.semibold,
  },

  // Activity / market tape card
  activityCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  activityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tapeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  activityRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activityLabel: {
    color: BRAND,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  activityCount: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: Typography.family.medium,
  },
  activityText: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: Typography.family.medium,
    lineHeight: 18,
  },

  contentWrap: {
    flex: 1,
  },
});
