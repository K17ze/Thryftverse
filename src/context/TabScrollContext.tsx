import React, { createContext, useContext, ReactNode } from 'react';
import { useSharedValue, SharedValue } from 'react-native-reanimated';

interface TabScrollContextType {
  tabBarVisible: SharedValue<boolean>;
}

export const TabScrollContext = createContext<TabScrollContextType | null>(null);

export const TabScrollProvider = ({ children }: { children: ReactNode }) => {
  const tabBarVisible = useSharedValue(true);

  return (
    <TabScrollContext.Provider value={{ tabBarVisible }}>
      {children}
    </TabScrollContext.Provider>
  );
};

export const useTabScroll = () => {
  const context = useContext(TabScrollContext);
  if (!context) throw new Error('useTabScroll must be used within TabScrollProvider');
  return context;
};
