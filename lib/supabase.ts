// This polyfill MUST be the first import in the module graph that touches
// Supabase: Hermes ships an incomplete URL/URLSearchParams, and supabase-js
// fails with "URL.hostname is not implemented" without it.
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/constants/config";
import type { Database } from "@/types/database";

/**
 * The single Supabase entry point. Every query in the app routes through this
 * module -- no inline `createClient` calls in components.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Required on native: there is no URL to parse a session out of.
    detectSessionInUrl: false,
  },
});

// Registered once at module scope. Doing this inside a component would add a
// duplicate listener on every remount.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});

/**
 * Error codes raised by the `enforce_report_rules` DB trigger. The trigger
 * prefixes its messages with these so the UI can show something specific
 * instead of a generic failure.
 */
export type ReportErrorCode =
  | "AUTH_REQUIRED"
  | "STATION_NOT_FOUND"
  | "RATE_LIMITED"
  | "LOCATION_REQUIRED"
  | "TOO_FAR"
  | "UNKNOWN";

/** Extracts the trigger's error code from a Postgres error message. */
export function parseReportError(message: string | undefined): ReportErrorCode {
  if (!message) return "UNKNOWN";
  const codes: ReportErrorCode[] = [
    "AUTH_REQUIRED",
    "STATION_NOT_FOUND",
    "RATE_LIMITED",
    "LOCATION_REQUIRED",
    "TOO_FAR",
  ];
  return codes.find((code) => message.includes(code)) ?? "UNKNOWN";
}

/** Error codes raised by the `enforce_submission_rules` trigger. */
export type SubmissionErrorCode =
  | "AUTH_REQUIRED"
  | "ALREADY_EXISTS"
  | "ALREADY_SUBMITTED"
  | "RATE_LIMITED"
  | "UNKNOWN";

export function parseSubmissionError(
  message: string | undefined,
): SubmissionErrorCode {
  if (!message) return "UNKNOWN";
  const codes: SubmissionErrorCode[] = [
    "AUTH_REQUIRED",
    "ALREADY_EXISTS",
    "ALREADY_SUBMITTED",
    "RATE_LIMITED",
  ];
  return codes.find((code) => message.includes(code)) ?? "UNKNOWN";
}

/**
 * The `ALREADY_EXISTS` message embeds the conflicting station's name, which is
 * far more useful to show than a generic "already listed". Pulls it back out.
 */
export function existingStationName(message: string | undefined): string | null {
  const match = /ALREADY_EXISTS:\s*(.+?)\s+is already listed here/.exec(message ?? "");
  return match?.[1] ?? null;
}

/** Builds the WKT literal PostGIS expects for a geography(Point, 4326) column. */
export function toPointWKT(longitude: number, latitude: number): string {
  // WKT is POINT(longitude latitude) -- longitude first, same as ST_MakePoint.
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}
