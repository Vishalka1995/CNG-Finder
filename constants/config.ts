/**
 * Runtime configuration and tuning constants.
 *
 * Env vars are read via `process.env.EXPO_PUBLIC_*`, which Expo inlines at
 * build time. They must be referenced as full static property accesses --
 * destructuring `process.env` breaks the inlining and yields undefined.
 */

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? "";

/**
 * Basemap style. Isolated in one constant so swapping MapTiler for OpenFreeMap
 * (no key, no session cap) is a one-line change if we hit the free-tier limit.
 */
export const MAP_STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

/** Radius for the nearby_stations RPC. */
export const NEARBY_RADIUS_M = 10_000;

/**
 * Reporter must be within this distance of the station.
 * 300m rather than the original 200m: Bangalore GPS drift in dense areas is
 * routinely 50-100m, and rejecting an honest driver is worse than accepting a
 * rare spoofed report. Mirrored in the DB trigger, which is the authority.
 */
export const REPORT_PROXIMITY_M = 300;

/** One report per station per user per this many minutes. Mirrored in the DB. */
export const REPORT_COOLDOWN_MIN = 30;

/** Reports older than this are ignored when computing status. */
export const CONFIDENCE_WINDOW_MIN = 60;

/** Fallback camera position when location permission is denied. */
export const BANGALORE_CENTER = { longitude: 77.5946, latitude: 12.9716 } as const;

export const DEFAULT_ZOOM = 12;

/** Client-side cache lifetime for the nearby-station list. */
export const STATION_CACHE_MS = 5 * 60 * 1000;

/** AsyncStorage / SecureStore keys. */
export const STORAGE_KEYS = {
  deviceId: "cngnow.device_id",
  onboarded: "cngnow.onboarded",
  cachedStations: "cngnow.cached_stations",
  recentSearches: "cngnow.recent_searches",
} as const;

/**
 * Values in .env.example (and the placeholders we ship for first run) are
 * non-empty but not real. Treating them as configured would send the app off to
 * a host that does not exist, so they are detected and rejected here.
 */
const isPlaceholder = (value: string): boolean =>
  value.length === 0 || value.toLowerCase().includes("placeholder");

/** True when the app has real env vars for Supabase. */
export const isSupabaseConfigured = (): boolean =>
  !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY);

/** True when a real MapTiler key is present; the basemap is blank without one. */
export const isMapConfigured = (): boolean => !isPlaceholder(MAPTILER_KEY);

/**
 * True when there is no real Supabase project configured, in which case the app
 * serves built-in demo stations so every screen is explorable. It switches off
 * automatically as soon as real keys are present in .env.
 */
export const isDemoMode = (): boolean => !isSupabaseConfigured();
