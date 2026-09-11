import * as Linking from "expo-linking";
import * as Location from "expo-location";

import { BANGALORE_CENTER } from "@/constants/config";

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
 * Current position, falling back to the Bangalore centre when permission is
 * denied or the fix fails. Callers should surface `isFallback` so the user
 * understands why distances may look wrong.
 */
export async function getCurrentCoords(): Promise<LocationResult> {
  const granted = await hasLocationPermission();

  if (!granted) {
    return { coords: { ...BANGALORE_CENTER }, isFallback: true, granted: false };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      isFallback: false,
      granted: true,
    };
  } catch {
    return { coords: { ...BANGALORE_CENTER }, isFallback: true, granted: true };
  }
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
