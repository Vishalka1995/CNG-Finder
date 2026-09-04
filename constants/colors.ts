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

/** Maps a station status to its marker / badge colour. */
export const STATUS_COLORS = {
  available: COLORS.available,
  long_queue: COLORS.queue,
  not_available: COLORS.unavailable,
  unknown: COLORS.unknown,
} as const;

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
