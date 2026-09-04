import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import type { StationStatus } from "@/types/database";

/**
 * The user's own report history.
 *
 * Kept on the device rather than queried back from Supabase. Two reasons:
 * the `reports_select_recent` RLS policy only exposes the last 24 hours, so the
 * server cannot answer "everything I have ever reported"; and a driver's own
 * history is useful offline, which is exactly when they are most likely to be
 * at a pump with poor signal.
 */

const STORAGE_KEY = "cngnow.my_reports";
const MAX_ENTRIES = 100;

export interface MyReport {
  id: string;
  stationId: string;
  stationName: string;
  status: StationStatus;
  note: string | null;
  createdAt: string;
}

interface ReportState {
  reports: MyReport[];
  isLoaded: boolean;

  load: () => Promise<void>;
  record: (entry: Omit<MyReport, "id" | "createdAt">) => Promise<void>;
  clear: () => Promise<void>;
}

export const useReportStore = create<ReportState>((set, get) => ({
  reports: [],
  isLoaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];

      const reports = Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is MyReport =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as MyReport).id === "string" &&
              typeof (entry as MyReport).stationId === "string",
          )
        : [];

      set({ reports, isLoaded: true });
    } catch {
      set({ reports: [], isLoaded: true });
    }
  },

  record: async (entry) => {
    const report: MyReport = {
      ...entry,
      id: `local-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    // Newest first, capped so the list cannot grow without bound.
    const next = [report, ...get().reports].slice(0, MAX_ENTRIES);
    set({ reports: next });

    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: the entry still exists for this session.
    }
  },

  clear: async () => {
    set({ reports: [] });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing useful to do if the removal fails.
    }
  },
}));
