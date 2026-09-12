import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { DEFAULT_MAP_STYLE, type MapStyleId } from "@/constants/config";

/**
 * Device-local user preferences.
 *
 * `notificationsEnabled` records the user's *preference* only -- there is no
 * push-registration or sending pipeline yet (that needs FCM credentials and a
 * rebuild, tracked separately in Phase 5). Storing the choice now means the
 * Settings toggle has real, testable behaviour, and the eventual registration
 * code can read the flag from day one.
 *
 * `mapStyle` chooses the basemap. Streets is the default because the core task
 * is navigating; satellite is there mainly to check whether a station's pin
 * actually sits on the forecourt.
 */

const STORAGE_KEY = "cngnow.preferences";

interface Preferences {
  notificationsEnabled: boolean;
  mapStyle: MapStyleId;
  /** Synthesises statuses, points and standings on-device for demos. Never
   *  writes to the backend -- see lib/showcase.ts. */
  showcaseMode: boolean;
}

const DEFAULTS: Preferences = {
  notificationsEnabled: true,
  mapStyle: DEFAULT_MAP_STYLE,
  showcaseMode: false,
};

interface PreferencesState extends Preferences {
  isLoaded: boolean;
  load: () => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setMapStyle: (style: MapStyleId) => Promise<void>;
  setShowcaseMode: (enabled: boolean) => Promise<void>;
}

/** Narrows unknown parsed JSON to a full Preferences object, field by field. */
function coerce(parsed: unknown): Preferences {
  if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
  const value = parsed as Partial<Preferences>;

  return {
    notificationsEnabled:
      typeof value.notificationsEnabled === "boolean"
        ? value.notificationsEnabled
        : DEFAULTS.notificationsEnabled,
    mapStyle:
      value.mapStyle === "streets" || value.mapStyle === "satellite"
        ? value.mapStyle
        : DEFAULTS.mapStyle,
    showcaseMode:
      typeof value.showcaseMode === "boolean"
        ? value.showcaseMode
        : DEFAULTS.showcaseMode,
  };
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  /**
   * Writes every preference, not just the one that changed. Persisting a
   * partial object would silently drop the others on the next load.
   */
  const persist = async (): Promise<void> => {
    const { notificationsEnabled, mapStyle, showcaseMode } = get();
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          notificationsEnabled,
          mapStyle,
          showcaseMode,
        } satisfies Preferences),
      );
    } catch {
      // Non-fatal: the in-memory value still holds for this session.
    }
  };

  return {
    ...DEFAULTS,
    isLoaded: false,

    load: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        set({ ...coerce(raw ? JSON.parse(raw) : null), isLoaded: true });
      } catch {
        set({ ...DEFAULTS, isLoaded: true });
      }
    },

    setNotificationsEnabled: async (enabled) => {
      set({ notificationsEnabled: enabled });
      await persist();
    },

    setMapStyle: async (style) => {
      set({ mapStyle: style });
      await persist();
    },

    setShowcaseMode: async (enabled) => {
      set({ showcaseMode: enabled });
      await persist();
    },
  };
});
