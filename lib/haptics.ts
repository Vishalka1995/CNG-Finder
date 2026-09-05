import { Platform } from "react-native";

/**
 * Thin haptics wrapper.
 *
 * `expo-haptics` is a native module -- requiring it before it is installed (or
 * before a dev build that includes it exists) would crash the whole app rather
 * than just skip the vibration. Every call here is wrapped so a missing or
 * not-yet-linked module degrades to silently doing nothing, never a crash.
 * Once `npx expo install expo-haptics` has run and the app is rebuilt, these
 * start working with no code change required.
 *
 * The shape below is declared locally (rather than as `typeof
 * import("expo-haptics")`) so this file typechecks even before the package is
 * installed -- a type-only import of an absent module is a compile error.
 */
interface HapticsModule {
  impactAsync: (style: string) => Promise<void>;
  notificationAsync: (type: string) => Promise<void>;
  ImpactFeedbackStyle: { Light: string; Medium: string; Heavy: string };
  NotificationFeedbackType: { Success: string; Warning: string; Error: string };
}

let cached: HapticsModule | null | undefined;

function getHaptics(): HapticsModule | null {
  if (cached !== undefined) return cached;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-haptics") as HapticsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** A light tap -- selecting an option, toggling a favourite. */
export function hapticSelect(): void {
  if (Platform.OS === "web") return;
  const haptics = getHaptics();
  if (!haptics) return;
  void haptics.impactAsync(haptics.ImpactFeedbackStyle.Light);
}

/** A confirming tap -- a report was submitted successfully. */
export function hapticSuccess(): void {
  if (Platform.OS === "web") return;
  const haptics = getHaptics();
  if (!haptics) return;
  void haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
}

/** A firmer tap -- a report was rejected (rate limit, too far, etc). */
export function hapticError(): void {
  if (Platform.OS === "web") return;
  const haptics = getHaptics();
  if (!haptics) return;
  void haptics.notificationAsync(haptics.NotificationFeedbackType.Error);
}
