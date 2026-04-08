import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { TabParamList } from './types';
import { Colors } from '../constants/colors';
import { Motion } from '../constants/motion';
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
    iconScale.value = withSpring(focused ? 1.12 : 1, Motion.spring.flagship);
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
          tabBarShowLabel: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            ...styles.fixedTabBar,
            height: 60 + Math.max(insets.bottom, 8),
            paddingTop: 6,
            paddingBottom: Math.max(insets.bottom, 8),
          },
          tabBarItemStyle: styles.tabBarItem,
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
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'home' : 'home-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'search' : 'search-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Sell"
          component={SellScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'add-circle' : 'add-circle-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="TradeHub"
          component={TradeHubScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'pulse' : 'pulse-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Inbox"
          component={InboxScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} focused={focused} badgeCount={3} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={MyProfileScreen}
          options={{
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
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    elevation: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    paddingHorizontal: 8,
  },
  tabBarItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  tabIconWrap: {
    alignItems: 'center',
    position: 'relative',
    width: 28,
  },
  activeIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.tabActive,
    marginTop: 3,
  },
});
