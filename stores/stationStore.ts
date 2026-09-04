import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import {
  NEARBY_RADIUS_M,
  STATION_CACHE_MS,
  STORAGE_KEYS,
  isSupabaseConfigured,
} from "@/constants/config";
import type { Coords } from "@/lib/location";
import { supabase } from "@/lib/supabase";
import type { NearbyStation } from "@/types/database";

interface StationState {
  stations: NearbyStation[];
  isLoading: boolean;
  /** Non-null when the last fetch failed; drives the error state in the UI. */
  error: string | null;
  /** True when `stations` came from AsyncStorage rather than the network. */
  isStale: boolean;
  lastFetchedAt: number | null;
  selectedStationId: string | null;

  fetchNearby: (coords: Coords, force?: boolean) => Promise<void>;
  loadCached: () => Promise<void>;
  selectStation: (id: string | null) => void;
  getStation: (id: string) => NearbyStation | undefined;
}

export const useStationStore = create<StationState>((set, get) => ({
  stations: [],
  isLoading: false,
  error: null,
  isStale: false,
  lastFetchedAt: null,
  selectedStationId: null,

  /**
   * Fetches stations near `coords`. Results are cached for STATION_CACHE_MS to
   * avoid re-querying on every map pan; pass `force` to bypass that.
   */
  fetchNearby: async (coords, force = false) => {
    const { lastFetchedAt, isLoading } = get();

    if (isLoading) return;
    if (
      !force &&
      lastFetchedAt !== null &&
      Date.now() - lastFetchedAt < STATION_CACHE_MS
    ) {
      return;
    }

    if (!isSupabaseConfigured()) {
      set({
        error: "Supabase is not configured. Copy .env.example to .env and restart.",
        isLoading: false,
      });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { data, error } = await supabase.rpc("nearby_stations", {
        lat: coords.latitude,
        lng: coords.longitude,
        radius_m: NEARBY_RADIUS_M,
      });

      if (error) throw new Error(error.message);

      const stations = data ?? [];
      set({
        stations,
        isLoading: false,
        error: null,
        isStale: false,
        lastFetchedAt: Date.now(),
      });

      // Cache for offline use. Failure here is non-fatal.
      void AsyncStorage.setItem(
        STORAGE_KEYS.cachedStations,
        JSON.stringify({ savedAt: Date.now(), stations }),
      ).catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load stations";
      set({ isLoading: false, error: message });

      // Fall back to whatever we last saw, so the app stays useful offline.
      if (get().stations.length === 0) {
        await get().loadCached();
      }
    }
  },

  /** Restores the last cached station list; used offline and on cold start. */
  loadCached: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.cachedStations);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { savedAt: number; stations: NearbyStation[] };
      if (Array.isArray(parsed.stations) && parsed.stations.length > 0) {
        set({ stations: parsed.stations, isStale: true });
      }
    } catch {
      // Corrupted cache is not worth surfacing; the next fetch replaces it.
    }
  },

  selectStation: (id) => set({ selectedStationId: id }),

  getStation: (id) => get().stations.find((station) => station.id === id),
}));
