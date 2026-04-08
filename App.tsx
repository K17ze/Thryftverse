import React from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_300Light,
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, Text, TextInput } from 'react-native';
import { ActiveTheme, Colors } from './src/constants/colors';
import { ToastProvider } from './src/context/ToastContext';
import { TabScrollProvider } from './src/context/TabScrollContext';
import { CurrencyProvider } from './src/context/CurrencyContext';
import { BackendDataProvider } from './src/context/BackendDataContext';
import { SettingsPreferencesProvider } from './src/context/SettingsPreferencesContext';
import { ToastContainer } from './src/components/Toast';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { BrandedSplash } from './src/components/BrandedSplash';
import { Typography } from './src/constants/typography';
import {
  applyThemePreference,
  getStoredThemePreference,
  subscribeThemePreferenceChange,
} from './src/theme/themePreference';
import { restoreAuthSession } from './src/services/authApi';
import { useStore } from './src/store/useStore';
import { getStoredProfileMedia } from './src/preferences/profileMediaPreferences';
import { getStoredAuthSnapshot } from './src/preferences/authSnapshot';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Keep app startup resilient even if splash API rejects.
});

let globalTypographyApplied = false;

function applyGlobalTypographyDefaults(useInterFonts: boolean) {
  if (globalTypographyApplied) {
    return;
  }

  globalTypographyApplied = true;

  const textFamily = useInterFonts ? Typography.family.regular : undefined;
  const inputFamily = useInterFonts ? Typography.family.medium : undefined;

  const textDefaultProps = (Text as any).defaultProps ?? {};
  (Text as any).defaultProps = {
    ...textDefaultProps,
    allowFontScaling: false,
    maxFontSizeMultiplier: 1.06,
    style: [textDefaultProps.style, { fontFamily: textFamily, letterSpacing: 0 }],
  };

  const inputDefaultProps = (TextInput as any).defaultProps ?? {};
  (TextInput as any).defaultProps = {
    ...inputDefaultProps,
    allowFontScaling: false,
    maxFontSizeMultiplier: 1.04,
    selectionColor: Colors.accent,
    style: [inputDefaultProps.style, { fontFamily: inputFamily, letterSpacing: 0 }],
  };
}

export default function App() {
  const [showBrandedSplash, setShowBrandedSplash] = React.useState(true);
  const [bootTimedOut, setBootTimedOut] = React.useState(false);
  const [themeInitialized, setThemeInitialized] = React.useState(false);
  const [ThemeReadyNavigator, setThemeReadyNavigator] = React.useState<React.ComponentType | null>(null);
  const [, setThemeTick] = React.useState(0);

  const [fontsLoaded, fontLoadError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      setBootTimedOut(true);
    }, 4500);

    return () => clearTimeout(timeoutId);
  }, []);

  React.useEffect(() => {
    const unsubscribe = subscribeThemePreferenceChange(() => {
      setThemeTick((value) => value + 1);
    });

    return unsubscribe;
  }, []);

  React.useEffect(() => {
    let mounted = true;

    const initializeAppBootstrapState = async () => {
      const preference = await getStoredThemePreference();
      applyThemePreference(preference);

      const [storedProfileMedia, localAuthSnapshot] = await Promise.all([
        getStoredProfileMedia(),
        getStoredAuthSnapshot(),
      ]);

      const store = useStore.getState();

      if (localAuthSnapshot?.user) {
        store.login(localAuthSnapshot.user);
        store.setTwoFactorEnabled(localAuthSnapshot.twoFactorEnabled);
      }

      if (storedProfileMedia.avatar) {
        store.updateUserAvatar(storedProfileMedia.avatar);
      }

      if (storedProfileMedia.cover) {
        store.updateUserCover(storedProfileMedia.cover);
      }

      store.hydrateProfileMediaOverrides(storedProfileMedia.byUserId);

      if (!mounted) {
        return;
      }

      const navigatorModule = require('./src/navigation/AppNavigator');
      setThemeReadyNavigator(() => navigatorModule.default);
      setThemeInitialized(true);

      restoreAuthSession()
        .then((restoredSession) => {
          if (!restoredSession) {
            return;
          }

          const latestStore = useStore.getState();
          latestStore.login(restoredSession.storeUser);
          latestStore.setTwoFactorEnabled(restoredSession.user.twoFactorEnabled);
        })
        .catch(() => {
          // Session refresh is best-effort and should not interrupt app usage.
        });
    };

    initializeAppBootstrapState().catch(() => {
      // Bootstrap failures should never block app startup.

      if (!mounted) {
        return;
      }

      const navigatorModule = require('./src/navigation/AppNavigator');
      setThemeReadyNavigator(() => navigatorModule.default);
      setThemeInitialized(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const fontsReady = fontsLoaded || !!fontLoadError || bootTimedOut;
  const appReady = fontsReady && themeInitialized && !!ThemeReadyNavigator;

  React.useEffect(() => {
    if (!appReady) {
      return;
    }

    applyGlobalTypographyDefaults(fontsLoaded);
    SplashScreen.hideAsync().catch(() => {
      // Ignore hide failures and continue rendering app.
    });
  }, [appReady, fontsLoaded]);

  if (!appReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#090909', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#e8dcc8" />
      </View>
    );
  }

  const baseNavigationTheme = ActiveTheme === 'light' ? DefaultTheme : DarkTheme;

  const premiumNavigationTheme: Theme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      primary: Colors.accent,
      background: Colors.background,
      card: Colors.surface,
      text: Colors.textPrimary,
      border: Colors.border,
      notification: Colors.danger,
    },
    fonts: {
      regular: {
        fontFamily: Typography.family.medium,
        fontWeight: '500' as const,
      },
      medium: {
        fontFamily: Typography.family.semibold,
        fontWeight: '600' as const,
      },
      bold: {
        fontFamily: Typography.family.bold,
        fontWeight: '700' as const,
      },
      heavy: {
        fontFamily: Typography.family.bold,
        fontWeight: '700' as const,
      },
    },
  };

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
                <SettingsPreferencesProvider>
                  <TabScrollProvider>
                    <NavigationContainer theme={premiumNavigationTheme}>
                      <StatusBar style={ActiveTheme === 'light' ? 'dark' : 'light'} backgroundColor={Colors.background} />
                      {ThemeReadyNavigator ? <ThemeReadyNavigator /> : null}
                    </NavigationContainer>
                  </TabScrollProvider>
                </SettingsPreferencesProvider>
              </CurrencyProvider>
            </BackendDataProvider>
            <ToastContainer />
          </ToastProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
