import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  StyleSheet
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabParamList } from './types';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';

import HomeScreen from '../screens/HomeScreen';
import TradeHubScreen from '../screens/TradeHubScreen';
import SearchScreen from '../screens/SearchScreen';
import SellScreen from '../screens/SellScreen';
import InboxScreen from '../screens/InboxScreen';
import MyProfileScreen from '../screens/MyProfileScreen';
import { useHaptic } from '../hooks/useHaptic';
import { AnimatedBadge } from '../components/AnimatedBadge';

const Tab = createBottomTabNavigator<TabParamList>();

// Custom Middle Circular Button
const SellButton = ({ onPress }: { onPress: () => void }) => {
  return (
    <AnimatedPressable style={styles.sellBtnWrap} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.sellBtnInner}>
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </View>
    </AnimatedPressable>
  );
};

interface SpringIconProps {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  badgeCount?: number;
}

const TabIcon = ({ name, color, badgeCount }: SpringIconProps) => {
  return (
    <View>
      <Ionicons name={name} size={22} color={color} />
      {badgeCount !== undefined && <AnimatedBadge count={badgeCount} />}
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
            fontSize: 11,
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
            tabBarLabel: 'Feed',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'documents' : 'documents-outline'} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="TradeHub"
          component={TradeHubScreen}
          options={{
            tabBarLabel: 'Trade Hub',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarLabel: 'Closet',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'bookmark' : 'bookmark-outline'} color={color} />
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
            tabBarLabel: 'Inbox',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} badgeCount={3} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={MyProfileScreen}
          options={{
            tabBarLabel: 'Profile',
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={focused ? 'person' : 'person-outline'} color={color} />
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
});

