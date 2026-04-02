import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import AuctionsScreen from './AuctionsScreen';
import SyndicateScreen from './SyndicateScreen';
import { useStore } from '../store/useStore';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type TradeHubTab = 'AUCTIONS' | 'SYNDICATE';
type NavT = StackNavigationProp<RootStackParamList>;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#1b1712';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#272727';
const PANEL_BORDER_STRONG = IS_LIGHT ? '#d0c3af' : '#3a342b';

export default function TradeHubScreen() {
  const navigation = useNavigation<NavT>();
  const { formatFromFiat } = useFormattedPrice();
  const [activeTab, setActiveTab] = React.useState<TradeHubTab>('AUCTIONS');
  const marketLedger = useStore((state) => state.marketLedger);

  const latestActivity = marketLedger[0];

  const latestActivityText = React.useMemo(() => {
    if (!latestActivity) {
      return 'No activity yet. Place a bid or buy units to start the tape.';
    }

    if (latestActivity.channel === 'auction' && latestActivity.action === 'bid') {
      return `Bid ${formatFromFiat(latestActivity.amountGBP, 'GBP', { displayMode: 'fiat' })} on ${latestActivity.referenceId}`;
    }

    if (latestActivity.channel === 'auction' && latestActivity.action === 'win') {
      return `Auction settled ${formatFromFiat(latestActivity.amountGBP, 'GBP', { displayMode: 'fiat' })} on ${latestActivity.referenceId}`;
    }

    if (latestActivity.channel === 'syndicate' && latestActivity.action === 'sell-units') {
      const units = latestActivity.units ?? 0;
      return `Sold ${units} unit${units === 1 ? '' : 's'} on ${latestActivity.referenceId}`;
    }

    const units = latestActivity.units ?? 0;
    return `Bought ${units} unit${units === 1 ? '' : 's'} on ${latestActivity.referenceId}`;
  }, [formatFromFiat, latestActivity]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.headerWrap}>
        <View>
          <Text style={styles.headerLabel}>MARKET LAYERS</Text>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>Trade Hub</Text>
            <Ionicons name="sparkles-outline" size={18} color={BRAND} />
          </View>
          <Text style={styles.headerSubtitle}>Timed auctions and 1ze fractional syndicates in one desk</Text>
        </View>
      </View>

      <View style={styles.tabSwitcher}>
        {(['AUCTIONS', 'SYNDICATE'] as const).map((tab) => (
          <AnimatedPressable
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.9}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'AUCTIONS' ? 'Auctions' : 'Syndicate'}
            </Text>
          </AnimatedPressable>
        ))}
      </View>

      <View style={styles.modeCard}>
        <Ionicons
          name={activeTab === 'AUCTIONS' ? 'hammer-outline' : 'pie-chart-outline'}
          size={14}
          color={BRAND}
        />
        <Text style={styles.modeCardText}>
          {activeTab === 'AUCTIONS'
            ? 'Auction mode: timed bids only, winner is highest valid bid at close.'
            : 'Syndicate mode: fractional unit trading, settlements quoted in 1ze with local previews.'}
        </Text>
      </View>

      <AnimatedPressable
        style={styles.activityCard}
        activeOpacity={0.92}
        onPress={() => navigation.navigate('MarketLedger')}
      >
        <View style={styles.activityTopRow}>
          <Text style={styles.activityLabel}>MARKET TAPE</Text>
          <View style={styles.activityRightWrap}>
            <Text style={styles.activityCount}>{marketLedger.length} events</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </View>
        </View>
        <Text style={styles.activityText} numberOfLines={2}>{latestActivityText}</Text>
      </AnimatedPressable>

      <View style={styles.contentWrap}>
        {activeTab === 'AUCTIONS' ? <AuctionsScreen /> : <SyndicateScreen />}
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
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLabel: {
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.3,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 31,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  tabSwitcher: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: PANEL_BG,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 4,
    flexDirection: 'row',
    gap: 6,
  },
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
    fontFamily: 'Inter_600SemiBold',
  },
  activityCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER_STRONG,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  activityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activityLabel: {
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },
  activityCount: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  activityText: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: Colors.accent,
  },
  tabText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },
  contentWrap: {
    flex: 1,
  },
});
