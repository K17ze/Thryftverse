import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { Colors } from './src/constants/colors';
import { ToastProvider } from './src/context/ToastContext';
import { TabScrollProvider } from './src/context/TabScrollContext';
import { CurrencyProvider } from './src/context/CurrencyContext';
import { BackendDataProvider } from './src/context/BackendDataContext';
import { ToastContainer } from './src/components/Toast';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { BrandedSplash } from './src/components/BrandedSplash';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [showBrandedSplash, setShowBrandedSplash] = React.useState(true);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  React.useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  if (showBrandedSplash) {
    return <BrandedSplash onFinish={() => setShowBrandedSplash(false)} />;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ToastProvider>
            <BackendDataProvider>
              <CurrencyProvider>
                <TabScrollProvider>
                  <NavigationContainer>
                    <StatusBar style="light" backgroundColor={Colors.background} />
                    <AppNavigator />
                  </NavigationContainer>
                </TabScrollProvider>
              </CurrencyProvider>
            </BackendDataProvider>
            <ToastContainer />
          </ToastProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
