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

export type MapStyleId = "streets" | "satellite";

/**
 * Basemap styles. Isolated here so swapping MapTiler for OpenFreeMap (no key,
 * no session cap) stays a small change if we ever hit the free-tier limit.
 *
 * Streets is the default: the core task is driving to a station, and satellite
 * imagery hides street names and route numbers while making the red pins
 * compete with rooftops and tarmac. Satellite earns its place as an option
 * because it is the quickest way to check whether a pin actually sits on the
 * forecourt -- a real problem in our data, not a hypothetical one.
 *
 * "satellite" maps to MapTiler's `hybrid`, not `satellite`: hybrid keeps road
 * labels over the imagery, and losing those makes the map much harder to use.
 */
export const MAP_STYLES: Record<MapStyleId, string> = {
  streets: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
  satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
};

export const DEFAULT_MAP_STYLE: MapStyleId = "streets";

/** @deprecated Prefer MAP_STYLES; kept so existing callers keep working. */
export const MAP_STYLE_URL = MAP_STYLES.streets;

/**
 * Radius for the nearby_stations RPC.
 * 30km rather than the original 10km: the real Bengaluru station data (GAIL's
 * official list) spans the whole gas-distribution area -- as far out as
 * Doddaballapur and Hoskote -- not just the city core, so 10km left most
 * stations invisible from anywhere in the city.
 */
export const NEARBY_RADIUS_M = 30_000;

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

/**
 * City-wide framing on open. A tighter zoom here seemed like the fix for
 * clustering hiding stations (see GROUP_MAX_ZOOM in StationMap.tsx for why
 * that isn't the right lever), but it backfires whenever the device's real
 * GPS position -- now resolved correctly thanks to the retry in
 * lib/location.ts -- simply isn't near a station: a tight zoom then shows
 * nothing but the user's own dot until they zoom out or pan. Keep this wide
 * and let GROUP_MAX_ZOOM do the decluttering instead.
 */
export const DEFAULT_ZOOM = 12;

/** Client-side cache lifetime for the nearby-station list. */
export const STATION_CACHE_MS = 5 * 60 * 1000;

/** AsyncStorage / SecureStore keys. */
export const STORAGE_KEYS = {
  deviceId: "cngnow.device_id",
  onboarded: "cngnow.onboarded",
  cachedStations: "cngnow.cached_stations",
  lastPosition: "cngnow.last_position",
  recentSearches: "cngnow.recent_searches",
  favorites: "cngnow.favorites",
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
