import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { STORAGE_KEYS, isDemoMode } from "@/constants/config";
import { supabase } from "@/lib/supabase";

/**
 * Favourites.
 *
 * Device-local first: AsyncStorage is the source of truth, so favourites work
 * offline, before any account exists, and with demo data. When Supabase is
 * configured the local set is also mirrored to the `favorites` table (which is
 * scoped to `auth.uid()` by RLS), giving cross-device sync later without any
 * change to the screens that consume this store.
 *
 * Remote failures are deliberately swallowed: a favourite is a convenience, and
 * losing one to a network blip should never surface an error to the driver.
 */

interface FavoriteState {
  /** Station ids the user has favourited. */
  ids: string[];
  isLoaded: boolean;

  load: () => Promise<void>;
  toggle: (stationId: string) => Promise<void>;
  isFavorite: (stationId: string) => boolean;
}

async function persistLocal(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(ids));
  } catch {
    // Non-fatal: the in-memory set still works for this session.
  }
}

/** Mirrors one change to Supabase when it is configured. Never throws. */
async function syncRemote(stationId: string, nowFavorite: boolean): Promise<void> {
  if (isDemoMode()) return;

  try {
    if (nowFavorite) {
      await supabase.from("favorites").insert({ station_id: stationId });
    } else {
      await supabase.from("favorites").delete().eq("station_id", stationId);
    }
  } catch {
    // Local state already updated; remote will reconcile on a later toggle.
  }
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  ids: [],
  isLoaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.favorites);
      const parsed: unknown = raw ? JSON.parse(raw) : [];

      const ids = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];

      set({ ids, isLoaded: true });
    } catch {
      set({ ids: [], isLoaded: true });
    }
  },

  toggle: async (stationId) => {
    const current = get().ids;
    const nowFavorite = !current.includes(stationId);

    const next = nowFavorite
      ? [...current, stationId]
      : current.filter((id) => id !== stationId);

    // Update immediately -- the heart must respond on the same frame as the tap.
    set({ ids: next });

    await persistLocal(next);
    void syncRemote(stationId, nowFavorite);
  },

  isFavorite: (stationId) => get().ids.includes(stationId),
}));
