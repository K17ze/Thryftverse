import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { createBottomTabNavigator, BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  withSpring,
} from 'react-native-reanimated';
import { TabParamList } from './types';
import { Colors } from '../constants/colors';
import { useTabScroll } from '../context/TabScrollContext';

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
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity style={styles.sellBtnWrap} onPress={onPress} activeOpacity={0.85}>
      <Reanimated.View style={[styles.sellBtnInner, animStyle]}>
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </Reanimated.View>
    </TouchableOpacity>
  );
};

interface SpringIconProps {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  badgeCount?: number;
}

const SpringIcon = ({ name, color, focused, badgeCount }: SpringIconProps) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused) {
      scale.value = withSequence(
        withSpring(1.2, { damping: 12 }),
        withSpring(1)
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [focused]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View>
      <Reanimated.View style={animStyle}>
        <Ionicons name={name} size={22} color={color} />
      </Reanimated.View>
      {badgeCount !== undefined && <AnimatedBadge count={badgeCount} />}
    </View>
  );
};

const AnimatedTabBar = (props: BottomTabBarProps) => {
  const { tabBarVisible } = useTabScroll();
  
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: withTiming(tabBarVisible.value ? 0 : 120, { duration: 300 }) }
      ],
      opacity: withTiming(tabBarVisible.value ? 1 : 0, { duration: 300 }),
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
    };
  });

  return (
    <Reanimated.View style={animatedStyle}>
      <BottomTabBar {...props} />
    </Reanimated.View>
  );
};

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const haptic = useHaptic();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Tab.Navigator
        tabBar={(props) => <AnimatedTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarStyle: {
            ...styles.floatingTabBar,
            bottom: Math.max(insets.bottom, 16),
          },
          tabBarActiveTintColor: Colors.tabActive,
          tabBarInactiveTintColor: Colors.tabInactive,
          tabBarLabelStyle: {
            fontSize: 10,
            fontFamily: 'Inter_500Medium',
            marginTop: 2,
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
              <SpringIcon name={focused ? 'documents' : 'documents-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="TradeHub"
          component={TradeHubScreen}
          options={{
            tabBarLabel: 'Trade',
            tabBarIcon: ({ color, focused }) => (
              <SpringIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarLabel: 'Closet',
            tabBarIcon: ({ color, focused }) => (
              <SpringIcon name={focused ? 'bookmark' : 'bookmark-outline'} color={color} focused={focused} />
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
              <SpringIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} focused={focused} badgeCount={3} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={MyProfileScreen}
          options={{
            tabBarLabel: 'Profile',
            tabBarIcon: ({ color, focused }) => (
              <SpringIcon name={focused ? 'person' : 'person-outline'} color={color} focused={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingTabBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 64,
    backgroundColor: '#0a0a0ad0',
    borderRadius: 32,
    borderTopWidth: 0,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    paddingBottom: 0,
    paddingHorizontal: 8,
  },
  sellBtnWrap: {
    top: -8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4ECDC4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
});

