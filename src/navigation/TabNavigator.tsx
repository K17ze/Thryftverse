import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabParamList } from './types';
import { Colors } from '../constants/colors';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import SellScreen from '../screens/SellScreen';
import InboxScreen from '../screens/InboxScreen';
import MyProfileScreen from '../screens/MyProfileScreen';

const Tab = createBottomTabNavigator<TabParamList>();

// Custom Middle Circular Button
const SellButton = ({ onPress }: { onPress: () => void }) => {
  return (
    <TouchableOpacity style={styles.sellBtnWrap} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.sellBtnInner}>
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </View>
    </TouchableOpacity>
  );
};

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  // We construct a floating pill effect by ignoring bottom inset inside the container,
  // then adding margin. We use a custom tab bar implementation.
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Tab.Navigator
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
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Feed',
            tabBarIcon: ({ color }) => (
              <Ionicons name="documents-outline" size={22} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarLabel: 'Closet',
            tabBarIcon: ({ color }) => (
              <Ionicons name="bookmark-outline" size={22} color={color} />
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
            tabBarIcon: ({ color }) => (
              <Ionicons name="chatbubbles-outline" size={22} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={MyProfileScreen}
          options={{
            tabBarLabel: 'Profile',
            tabBarIcon: ({ color }) => (
              <Ionicons name="person-outline" size={22} color={color} />
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
    backgroundColor: '#0a0a0ad0', // Transparent deep dark
    borderRadius: 32,
    borderTopWidth: 0,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    paddingBottom: 0, // Reset bottom padding inside tab container
    paddingHorizontal: 8,
  },
  sellBtnWrap: {
    top: -8, // floats up slightly
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
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
});
