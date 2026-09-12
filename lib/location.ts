import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Location from "expo-location";

import { BANGALORE_CENTER, STORAGE_KEYS } from "@/constants/config";

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface LocationResult {
  coords: Coords;
  /** True when `coords` is the city-centre fallback rather than a real fix. */
  isFallback: boolean;
  granted: boolean;
}

export interface PositionFix {
  coords: Coords;
  /** Radius in metres, when the platform reports one. */
  accuracy: number | null;
}

/** Asks for foreground location permission. Never requests background access. */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function hasLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * A fix older than this is treated as no fix at all.
 *
 * Android's fused location provider will happily hand back a position cached
 * from a previous trip, and it arrives looking exactly like a fresh one. In a
 * single-city app that is harmless; here it means a driver standing in
 * Kolhapur can be handed their last Bangalore fix and have the app search
 * 400 km away -- every real station near them vanishes from the list.
 */
const MAX_FIX_AGE_MS = 5 * 60 * 1000;

/** Retry delay for the first fix after permission is freshly granted -- the
 *  location provider is commonly still starting up at that point. */
const FIRST_FIX_RETRY_MS = 1500;

/**
 * Remembers the last genuine fix so a later failure falls back to the city the
 * driver was actually in. The hardcoded city centre is a poor fallback now
 * that there is more than one city: it silently relocates the user.
 */
async function rememberCoords(coords: Coords): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.lastPosition, JSON.stringify(coords));
  } catch {
    // Non-fatal: the fix still holds for this session.
  }
}

/** The last genuine fix from a previous run, if there is one. */
export async function getRememberedCoords(): Promise<Coords | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.lastPosition);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Coords>;
    if (typeof parsed.latitude !== "number" || typeof parsed.longitude !== "number") {
      return null;
    }
    return { latitude: parsed.latitude, longitude: parsed.longitude };
  } catch {
    return null;
  }
}

/**
 * The platform's already-cached fix, if it is recent enough to trust. Returns
 * immediately -- it never waits on the GPS hardware.
 *
 * This exists to seed the map's location puck. MapLibre's LocationManager
 * replays a position to a new listener only when it already holds one, so on a
 * cold start the puck sits invisible for however long the native provider
 * takes to produce its first fix -- several seconds. Handing it a position we
 * already have skips that wait. Capped by the same freshness rule as a live
 * fix, so a cached position from a previous trip is never drawn as "you".
 */
export async function getLastKnownFix(): Promise<PositionFix | null> {
  try {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: MAX_FIX_AGE_MS,
    });
    if (!position) return null;

    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      accuracy: position.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}

async function tryGetPosition(): Promise<Coords | null> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    if (Date.now() - position.timestamp > MAX_FIX_AGE_MS) return null;

    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}

async function fallbackCoords(): Promise<Coords> {
  return (await getRememberedCoords()) ?? { ...BANGALORE_CENTER };
}

/**
 * Current position, falling back to the last remembered fix (then the
 * Bangalore centre) when permission is denied or no fresh fix is available.
 * Callers should surface `isFallback` so the user understands why distances
 * may look wrong.
 *
 * Retries once: the very first fix right after permission is granted
 * (typically straight out of onboarding) commonly fails while the location
 * provider is still warming up, and without a retry the map would silently
 * stick with the fallback centre -- and no live-location dot -- all session.
 */
export async function getCurrentCoords(): Promise<LocationResult> {
  const granted = await hasLocationPermission();

  if (!granted) {
    return { coords: await fallbackCoords(), isFallback: true, granted: false };
  }

  const first = await tryGetPosition();
  if (first) {
    void rememberCoords(first);
    return { coords: first, isFallback: false, granted: true };
  }

  await new Promise((resolve) => setTimeout(resolve, FIRST_FIX_RETRY_MS));

  const retry = await tryGetPosition();
  if (retry) {
    void rememberCoords(retry);
    return { coords: retry, isFallback: false, granted: true };
  }

  return { coords: await fallbackCoords(), isFallback: true, granted: true };
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle distance in metres.
 *
 * Used only for display and for the pre-submit proximity hint. The database
 * trigger recomputes distance with PostGIS and is the authority -- a
 * client-side check is trivially bypassed.
 */
export function distanceMeters(a: Coords, b: Coords): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Human-readable distance: "820 m", "1.2 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** A station's identifying fields for building a directions link. */
export interface DirectionsTarget {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Builds a Google Maps directions URL to a station. No origin is specified,
 * so Google Maps uses the device's current location as the starting point.
 */
export function directionsUrl(station: DirectionsTarget): string {
  const label = encodeURIComponent(station.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}&destination_place_id=${label}`;
}

/** Opens the device's map app with directions to a station. */
export function openDirections(station: DirectionsTarget): void {
  void Linking.openURL(directionsUrl(station));
}
