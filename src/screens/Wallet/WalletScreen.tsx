/**
 * WalletScreen - Consolidated (Balance + History + Convert)
 * Uses new design system: Space, Radius, T (Text components)
 * Instagram-style header with collapsible sections
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
} from 'react-native-reanimated';

import { Colors } from '../../constants/colors';
import { Space, Radius, Duration } from '../../theme/designTokens';
import { T, Price } from '../../components/ui/Text';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';

// Types
interface WalletData {
  fiatBalance: number;
  izeBalance: number; // in mg (divide by 1000 for display)
  currency: string;
}

interface Transaction {
  id: string;
  type: 'sale' | 'purchase' | 'convert_in' | 'convert_out' | 'withdrawal';
  amount: number;
  currency: string;
  description: string;
  date: string;
  status: 'completed' | 'pending';
}

// Mock data
const MOCK_WALLET: WalletData = {
  fiatBalance: 125.5,
  izeBalance: 50000, // 50 1ze
  currency: 'GBP',
};

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: '1', type: 'sale', amount: 45, currency: 'GBP', description: 'Y2K Hoodie sold', date: 'Today, 14:30', status: 'completed' },
  { id: '2', type: 'convert_in', amount: 50, currency: '1ZE', description: 'Converted £25 to 1ze', date: 'Yesterday, 09:12', status: 'completed' },
  { id: '3', type: 'purchase', amount: 25, currency: 'GBP', description: 'Vintage Tee bought', date: '2 days ago', status: 'completed' },
  { id: '4', type: 'withdrawal', amount: 100, currency: 'GBP', description: 'Withdrawal to Monzo', date: '12 Mar 2026', status: 'completed' },
];

type TabType = 'overview' | 'history';

export default function WalletScreen() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(false);
  const [wallet, setWallet] = useState<WalletData>(MOCK_WALLET);
  const scrollY = useSharedValue(0);

  // Header animation
  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, 100], [180, 120]),
    opacity: interpolate(scrollY.value, [0, 50], [1, 0.9]),
  }));

  const onRefresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  }, []);

  const formatIze = (mg: number) => (mg / 1000).toFixed(0);

  const getTransactionIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'sale': return { name: 'cash-outline' as const, color: Colors.success };
      case 'purchase': return { name: 'cart-outline' as const, color: Colors.textPrimary };
      case 'convert_in': return { name: 'swap-horizontal' as const, color: Colors.accent };
      case 'convert_out': return { name: 'swap-horizontal' as const, color: Colors.accentGold };
      case 'withdrawal': return { name: 'arrow-down-outline' as const, color: Colors.textSecondary };
      default: return { name: 'ellipsis-horizontal' as const, color: Colors.textMuted };
    }
  };

  const renderOverview = () => (
    <View style={styles.tabContent}>
      {/* Balances */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <View style={styles.balanceItem}>
            <T.Caption>Fiat Balance</T.Caption>
            {loading ? (
              <Skeleton variant="text" width={80} />
            ) : (
              <Price amount={wallet.fiatBalance} />
            )}
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceItem}>
            <T.Caption>1ze Balance</T.Caption>
            {loading ? (
              <Skeleton variant="text" width={60} />
            ) : (
              <T.Title3>{formatIze(wallet.izeBalance)} 1ze</T.Title3>
            )}
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsGrid}>
        <TouchableOpacity style={styles.actionBtn}>
          <View style={[styles.actionIcon, { backgroundColor: Colors.accent + '20' }]}>
            <Ionicons name="add-circle" size={24} color={Colors.accent} />
          </View>
          <T.Caption>Load Fiat</T.Caption>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <View style={[styles.actionIcon, { backgroundColor: Colors.success + '20' }]}>
            <Ionicons name="swap-horizontal" size={24} color={Colors.success} />
          </View>
          <T.Caption>Buy 1ze</T.Caption>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <View style={[styles.actionIcon, { backgroundColor: Colors.accentGold + '20' }]}>
            <Ionicons name="swap-horizontal" size={24} color={Colors.accentGold} />
          </View>
          <T.Caption>Convert</T.Caption>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <View style={[styles.actionIcon, { backgroundColor: Colors.textSecondary + '20' }]}>
            <Ionicons name="arrow-down" size={24} color={Colors.textSecondary} />
          </View>
          <T.Caption>Withdraw</T.Caption>
        </TouchableOpacity>
      </View>

      {/* Recent Activity Preview */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <T.Headline>Recent Activity</T.Headline>
          <TouchableOpacity onPress={() => setActiveTab('history')}>
            <T.Caption color={Colors.accent}>See All</T.Caption>
          </TouchableOpacity>
        </View>

        {MOCK_TRANSACTIONS.slice(0, 3).map((tx) => {
          const icon = getTransactionIcon(tx.type);
          const isPositive = tx.type === 'sale' || tx.type === 'convert_in';

          return (
            <View key={tx.id} style={styles.txItem}>
              <View style={[styles.txIcon, { backgroundColor: icon.color + '15' }]}>
                <Ionicons name={icon.name} size={18} color={icon.color} />
              </View>
              <View style={styles.txInfo}>
                <T.BodyEmphasis numberOfLines={1}>{tx.description}</T.BodyEmphasis>
                <T.Caption>{tx.date}</T.Caption>
              </View>
              <T.BodyEmphasis color={isPositive ? Colors.success : Colors.textPrimary}>
                {isPositive ? '+' : '-'}{tx.currency === 'GBP' ? '£' : ''}{tx.amount}
              </T.BodyEmphasis>
            </View>
          );
        })}
      </View>
    </View>
  );

  const renderHistory = () => (
    <View style={styles.tabContent}>
      {MOCK_TRANSACTIONS.map((tx) => {
        const icon = getTransactionIcon(tx.type);
        const isPositive = tx.type === 'sale' || tx.type === 'convert_in';

        return (
          <View key={tx.id} style={styles.txItem}>
            <View style={[styles.txIcon, { backgroundColor: icon.color + '15' }]}>
              <Ionicons name={icon.name} size={18} color={icon.color} />
            </View>
            <View style={styles.txInfo}>
              <T.BodyEmphasis numberOfLines={1}>{tx.description}</T.BodyEmphasis>
              <T.Caption>{tx.date}</T.Caption>
            </View>
            <View style={styles.txAmount}>
              <T.BodyEmphasis color={isPositive ? Colors.success : Colors.textPrimary}>
                {isPositive ? '+' : '-'}{tx.currency === 'GBP' ? '£' : ''}{tx.amount}
              </T.BodyEmphasis>
              <T.Caption>{tx.status}</T.Caption>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <Animated.View style={[styles.header, headerStyle]}>
        <T.Title2>Wallet</T.Title2>
        <TouchableOpacity style={styles.settingsBtn}>
          <Ionicons name="settings-outline" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
      </Animated.View>

      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
          onPress={() => setActiveTab('overview')}
        >
          <T.BodyEmphasis color={activeTab === 'overview' ? Colors.accent : Colors.textSecondary}>
            Overview
          </T.BodyEmphasis>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
        >
          <T.BodyEmphasis color={activeTab === 'history' ? Colors.accent : Colors.textSecondary}>
            History
          </T.BodyEmphasis>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          scrollY.value = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={onRefresh}
            tintColor={Colors.textSecondary}
          />
        }
      >
        {activeTab === 'overview' ? renderOverview() : renderHistory()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
  },
  settingsBtn: {
    padding: Space.sm,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: Space.md,
    marginBottom: Space.sm,
    gap: Space.sm,
  },
  tab: {
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.full,
  },
  tabActive: {
    backgroundColor: Colors.accent + '15',
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Space.xxl,
  },
  tabContent: {
    paddingHorizontal: Space.md,
  },

  // Balance Card
  balanceCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Space.lg,
    marginBottom: Space.md,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceItem: {
    flex: 1,
    alignItems: 'center',
    gap: Space.xs,
  },
  balanceDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },

  // Actions
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Space.lg,
  },
  actionBtn: {
    alignItems: 'center',
    gap: Space.xs,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Section
  section: {
    gap: Space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.sm,
  },

  // Transaction Item
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.md,
    gap: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: {
    flex: 1,
    gap: Space.xs / 2,
  },
  txAmount: {
    alignItems: 'flex-end',
    gap: Space.xs / 2,
  },
});
