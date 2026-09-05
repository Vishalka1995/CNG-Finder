import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * Device-local user preferences.
 *
 * `notificationsEnabled` only records the user's *preference* today -- there is
 * no push-registration or sending pipeline wired up yet (that needs FCM
 * credentials and a rebuild, tracked separately in Phase 5). Storing the
 * choice now means the toggle in Settings has real, testable behaviour, and
 * the eventual push-registration code can read this flag from day one instead
 * of needing its own migration.
 */

const STORAGE_KEY = "cngnow.preferences";

interface Preferences {
  notificationsEnabled: boolean;
}

const DEFAULTS: Preferences = {
  notificationsEnabled: true,
};

interface PreferencesState extends Preferences {
  isLoaded: boolean;
  load: () => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
}

async function persist(prefs: Preferences): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Non-fatal: the in-memory value still holds for this session.
  }
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;

      const notificationsEnabled =
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as Preferences).notificationsEnabled === "boolean"
          ? (parsed as Preferences).notificationsEnabled
          : DEFAULTS.notificationsEnabled;

      set({ notificationsEnabled, isLoaded: true });
    } catch {
      set({ ...DEFAULTS, isLoaded: true });
    }
  },

  setNotificationsEnabled: async (enabled) => {
    set({ notificationsEnabled: enabled });
    await persist({ notificationsEnabled: enabled });
  },
}));
