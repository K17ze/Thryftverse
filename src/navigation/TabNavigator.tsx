import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { TabParamList } from './types';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { AnimatedBadge } from '../components/AnimatedBadge';
import { useHaptic } from '../hooks/useHaptic';

import HomeScreen from '../screens/HomeScreen';
import TradeHubScreen from '../screens/TradeHubScreen';
import SearchScreen from '../screens/SearchScreen';
import SellScreen from '../screens/SellScreen';
import InboxScreen from '../screens/InboxScreen';
import MyProfileScreen from '../screens/MyProfileScreen';

const Tab = createBottomTabNavigator<TabParamList>();

// ── Animated Sell FAB with subtle breathing pulse ──
const SellButton = ({ onPress }: { onPress: () => void }) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable style={styles.sellBtnWrap} onPress={onPress} activeOpacity={0.85}>
      <Reanimated.View style={[styles.sellBtnInner, pulseStyle]}>
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </Reanimated.View>
    </AnimatedPressable>
  );
};

// ── Tab Icon with spring scale + active indicator dot ──
interface TabIconProps {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  badgeCount?: number;
}

const TabIcon = ({ name, color, focused, badgeCount }: TabIconProps) => {
  const iconScale = useSharedValue(focused ? 1.12 : 1);

  useEffect(() => {
    iconScale.value = withSpring(focused ? 1.12 : 1, { damping: 14, stiffness: 200 });
  }, [focused, iconScale]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const dotOpacity = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    dotOpacity.value = withTiming(focused ? 1 : 0, { duration: 200 });
  }, [focused, dotOpacity]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
    transform: [{ scale: dotOpacity.value }],
  }));

  return (
    <View style={styles.tabIconWrap}>
      <Reanimated.View style={animatedIconStyle}>
        <Ionicons name={name} size={22} color={color} />
      </Reanimated.View>
      {badgeCount !== undefined && <AnimatedBadge count={badgeCount} />}
      <Reanimated.View style={[styles.activeIndicator, dotStyle]} />
    </View>
  );
};

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const haptic = useHaptic();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            ...styles.fixedTabBar,
            height: 62 + Math.max(insets.bottom, 8),
            paddingBottom: Math.max(insets.bottom, 8),
          },
          tabBarActiveTintColor: Colors.tabActive,
          tabBarInactiveTintColor: Colors.tabInactive,
          tabBarLabelStyle: {
            fontSize: 10,
            fontFamily: Typography.family.semibold,
            letterSpacing: 0.2,
            marginTop: 1,
            marginBottom: 2,
          },
        }}
        screenListeners={{
          tabPress: () => {
            haptic.light();
          },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'feed',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'documents' : 'documents-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="TradeHub"
          component={TradeHubScreen}
          options={{
            tabBarLabel: 'trade',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarLabel: 'closet',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'bookmark' : 'bookmark-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Sell"
          component={SellScreen}
          options={{
            tabBarButton: (props) => (
              <SellButton onPress={props.onPress as any} />
            ),
          }}
        />
        <Tab.Screen
          name="Inbox"
          component={InboxScreen}
          options={{
            tabBarLabel: 'dms',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} focused={focused} badgeCount={3} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={MyProfileScreen}
          options={{
            tabBarLabel: 'you',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'person' : 'person-outline'} color={color} focused={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  fixedTabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    elevation: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.34,
    shadowRadius: 10,
    paddingHorizontal: 14,
  },
  sellBtnWrap: {
    top: -4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#e8dcc8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  tabIconWrap: {
    alignItems: 'center',
    position: 'relative',
  },
  activeIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.tabActive,
    marginTop: 3,
  },
});
