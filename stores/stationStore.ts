import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import {
  NEARBY_RADIUS_M,
  STATION_CACHE_MS,
  STORAGE_KEYS,
  isDemoMode,
  isSupabaseConfigured,
} from "@/constants/config";
import { summarize } from "@/lib/confidence";
import { addDemoReport, getDemoReports, getDemoStations } from "@/lib/demoData";
import type { Coords } from "@/lib/location";
import { showcaseStations } from "@/lib/showcase";
import { supabase } from "@/lib/supabase";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { NearbyStation, StationStatus } from "@/types/database";

interface StationState {
  stations: NearbyStation[];
  isLoading: boolean;
  /** Non-null when the last fetch failed; drives the error state in the UI. */
  error: string | null;
  /** True when `stations` came from AsyncStorage rather than the network. */
  isStale: boolean;
  /** True when the list is built-in demo data, not a real backend. */
  isDemo: boolean;
  lastFetchedAt: number | null;
  selectedStationId: string | null;

  fetchNearby: (coords: Coords, force?: boolean) => Promise<void>;
  loadCached: () => Promise<void>;
  selectStation: (id: string | null) => void;
  getStation: (id: string) => NearbyStation | undefined;
  /**
   * Recomputes one station immediately after the user reports it, so the marker
   * and badge change without waiting for a refetch. Reconciled by the next
   * successful fetchNearby.
   */
  applyOptimisticReport: (stationId: string, status: StationStatus) => void;
}

export const useStationStore = create<StationState>((set, get) => ({
  stations: [],
  isLoading: false,
  error: null,
  isStale: false,
  isDemo: false,
  lastFetchedAt: null,
  selectedStationId: null,

  /**
   * Fetches stations near `coords`. Results are cached for STATION_CACHE_MS to
   * avoid re-querying on every map pan; pass `force` to bypass that.
   *
   * The reentrancy guard below only blocks a second CACHED call while one is
   * already in flight -- a `force` call (e.g. pull-to-refresh) always proceeds,
   * so a screen driving its own local `refreshing` flag with try/finally never
   * gets stuck waiting on a fetch that was silently dropped.
   */
  fetchNearby: async (coords, force = false) => {
    const { lastFetchedAt, isLoading } = get();

    if (isLoading && !force) return;
    if (
      !force &&
      lastFetchedAt !== null &&
      Date.now() - lastFetchedAt < STATION_CACHE_MS
    ) {
      return;
    }

    // No real backend yet: serve built-in stations so the app is explorable.
    if (isDemoMode()) {
      set({
        stations: getDemoStations(coords),
        isLoading: false,
        error: null,
        isStale: false,
        isDemo: true,
        lastFetchedAt: Date.now(),
      });
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

      // Showcase mode keeps the real stations and their real coordinates, and
      // only invents the crowd-sourced half -- so a demo shows the actual
      // network, not a fictional city. See lib/showcase.ts.
      const stations = usePreferencesStore.getState().showcaseMode
        ? showcaseStations(data ?? [])
        : (data ?? []);

      // A fetch that comes back empty should not erase a list that was
      // already showing -- on cold start this is called with whatever GPS
      // fix resolved first, and a transient bad fix (a stale cached
      // last-known location, momentary drift) is far more likely than the
      // driver having genuinely moved somewhere with zero stations in 30km.
      // An explicit refresh (force) is trusted either way, since the user
      // asked for that fetch specifically.
      if (stations.length === 0 && !force && get().stations.length > 0) {
        set({ isLoading: false, error: null });
        return;
      }

      set({
        stations,
        isLoading: false,
        error: null,
        isStale: false,
        isDemo: false,
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

  applyOptimisticReport: (stationId, status) => {
    if (isDemoMode()) addDemoReport(stationId, status, null);

    set((state) => ({
      stations: state.stations.map((station) => {
        if (station.id !== stationId) return station;

        // In demo mode the full report history is available, so the summary is
        // exact. Against the real backend only aggregates are held locally, so
        // the fresh report is blended with a synthetic stand-in for the
        // existing ones -- close enough until the next fetch reconciles it.
        const now = new Date().toISOString();
        const history = isDemoMode()
          ? getDemoReports(stationId)
          : [
              { status, created_at: now },
              ...(station.status && station.last_reported_at
                ? [{ status: station.status, created_at: station.last_reported_at }]
                : []),
            ];

        const summary = summarize(history);

        return {
          ...station,
          status: summary.status,
          confidence: summary.confidence,
          report_count: summary.reportCount,
          last_reported_at: summary.lastReportedAt ?? now,
        };
      }),
    }));
  },
}));
