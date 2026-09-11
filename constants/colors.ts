/**
 * Design tokens. These are duplicated in tailwind.config.js on purpose:
 * NativeWind consumes the Tailwind config, but map style expressions and any
 * StyleSheet fallback need plain JS values. Keep the two in sync.
 */

export const COLORS = {
  primary: "#00A86B",
  available: "#22C55E",
  queue: "#F59E0B",
  unavailable: "#EF4444",
  unknown: "#94A3B8",
  surface: "#FFFFFF",
  ink: "#0F172A",
  muted: "#64748B",
} as const;

/**
 * Maps a station status to its badge colour.
 *
 * Used by StatusBadge and the station rows -- NOT by the map. Map pins are a
 * single fixed colour (MAP_PIN_COLOR below); see the note there.
 */
export const STATUS_COLORS = {
  available: COLORS.available,
  long_queue: COLORS.queue,
  not_available: COLORS.unavailable,
  unknown: COLORS.unknown,
} as const;

/**
 * Map pin colour, matching the red Google Maps uses for fuel stations.
 *
 * Deliberately one colour for every pin rather than per-status. Status-coloured
 * pins were tried first, but with crowd-sourced reporting most stations have no
 * recent report at any given moment, so the map rendered as a field of grey --
 * it read as broken rather than as "no data yet". A uniform, familiar pin makes
 * the map legible; status is still shown wherever a station is named: the
 * nearby sheet rows, the list, and the station detail screen.
 */
export const MAP_PIN_COLOR = "#D93025";

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  hero: 32,
  title: 24,
  heading: 18,
  body: 16,
  caption: 14,
  label: 12,
} as const;

export const FONTS = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;
