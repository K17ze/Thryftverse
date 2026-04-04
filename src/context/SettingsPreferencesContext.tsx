import React from 'react';
import {
  buildDefaultPushNotificationToggles,
  countEnabledPushNotificationToggles,
  getStoredPushNotificationToggles,
  getStoredSettingsPreferences,
  LANGUAGE_OPTIONS,
  PUSH_NOTIFICATION_DEFINITIONS,
  PushNotificationToggles,
  setStoredPushNotificationToggles,
  setStoredSettingsPreferences,
  SupportedLanguageOption,
} from '../preferences/settingsPreferences';

interface SettingsPreferencesContextValue {
  language: SupportedLanguageOption;
  emailNotificationsEnabled: boolean;
  pushNotificationToggles: PushNotificationToggles;
  pushEnabledCount: number;
  pushTotalCount: number;
  isHydrated: boolean;
  setLanguage: (language: SupportedLanguageOption) => void;
  setEmailNotificationsEnabled: (enabled: boolean) => void;
  toggleEmailNotifications: () => void;
  setPushNotificationToggle: (key: string, enabled: boolean) => void;
  setAllPushNotificationToggles: (enabled: boolean) => void;
}

const DEFAULT_LANGUAGE = LANGUAGE_OPTIONS[0];
const DEFAULT_PUSH_NOTIFICATION_TOGGLES = buildDefaultPushNotificationToggles(
  PUSH_NOTIFICATION_DEFINITIONS.map((item) => item.key)
);

const SettingsPreferencesContext = React.createContext<SettingsPreferencesContextValue | undefined>(undefined);

export function SettingsPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = React.useState<SupportedLanguageOption>(DEFAULT_LANGUAGE);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = React.useState(true);
  const [pushNotificationToggles, setPushNotificationToggles] = React.useState<PushNotificationToggles>(
    DEFAULT_PUSH_NOTIFICATION_TOGGLES
  );
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;

    Promise.all([
      getStoredSettingsPreferences(),
      getStoredPushNotificationToggles(DEFAULT_PUSH_NOTIFICATION_TOGGLES),
    ])
      .then(([settingsPreferences, storedPushToggles]) => {
        if (!isMounted) {
          return;
        }

        setLanguage(settingsPreferences.language);
        setEmailNotificationsEnabled(settingsPreferences.emailNotificationsEnabled);
        setPushNotificationToggles(storedPushToggles);
      })
      .catch(() => {
        // Keep defaults when persistence is unavailable.
      })
      .finally(() => {
        if (isMounted) {
          setIsHydrated(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!isHydrated) {
      return;
    }

    setStoredSettingsPreferences({
      language,
      emailNotificationsEnabled,
    }).catch(() => {
      // Best-effort persistence should not block preferences updates.
    });
  }, [language, emailNotificationsEnabled, isHydrated]);

  React.useEffect(() => {
    if (!isHydrated) {
      return;
    }

    setStoredPushNotificationToggles(pushNotificationToggles).catch(() => {
      // Best-effort persistence should not block preferences updates.
    });
  }, [pushNotificationToggles, isHydrated]);

  const toggleEmailNotifications = React.useCallback(() => {
    setEmailNotificationsEnabled((prev) => !prev);
  }, []);

  const setPushNotificationToggle = React.useCallback((key: string, enabled: boolean) => {
    setPushNotificationToggles((prev) => {
      if (!(key in prev)) {
        return prev;
      }

      return {
        ...prev,
        [key]: enabled,
      };
    });
  }, []);

  const setAllPushNotificationToggles = React.useCallback((enabled: boolean) => {
    const nextState = buildDefaultPushNotificationToggles(
      PUSH_NOTIFICATION_DEFINITIONS.map((item) => item.key)
    );

    if (!enabled) {
      Object.keys(nextState).forEach((key) => {
        nextState[key] = false;
      });
    }

    setPushNotificationToggles(nextState);
  }, []);

  const pushEnabledCount = React.useMemo(
    () => countEnabledPushNotificationToggles(pushNotificationToggles),
    [pushNotificationToggles]
  );

  const value = React.useMemo<SettingsPreferencesContextValue>(
    () => ({
      language,
      emailNotificationsEnabled,
      pushNotificationToggles,
      pushEnabledCount,
      pushTotalCount: PUSH_NOTIFICATION_DEFINITIONS.length,
      isHydrated,
      setLanguage,
      setEmailNotificationsEnabled,
      toggleEmailNotifications,
      setPushNotificationToggle,
      setAllPushNotificationToggles,
    }),
    [
      emailNotificationsEnabled,
      isHydrated,
      language,
      pushEnabledCount,
      pushNotificationToggles,
      setAllPushNotificationToggles,
      setPushNotificationToggle,
      toggleEmailNotifications,
    ]
  );

  return <SettingsPreferencesContext.Provider value={value}>{children}</SettingsPreferencesContext.Provider>;
}

export function useSettingsPreferences() {
  const context = React.useContext(SettingsPreferencesContext);
  if (!context) {
    throw new Error('useSettingsPreferences must be used within SettingsPreferencesProvider');
  }

  return context;
}
