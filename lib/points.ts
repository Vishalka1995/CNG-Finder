import {
  SHOWCASE_BADGES,
  SHOWCASE_MY_PLACE,
  SHOWCASE_POINTS,
  SHOWCASE_WINNERS,
  showcaseLeaderboard,
} from "@/lib/showcase";
import { supabase } from "@/lib/supabase";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type {
  HallOfFameRow,
  LeaderboardRow,
  MyPlaceRow,
  UserPointsRow,
} from "@/types/database";

/**
 * Read outside React on purpose: these are plain async functions, not hooks,
 * and threading a flag down through every caller would put a demo concern into
 * signatures that have nothing to do with demos.
 */
const isShowcase = (): boolean => usePreferencesStore.getState().showcaseMode;

/** Matches the bound enforced by users_display_name_length (migration 0010). */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 20;

/**
 * Reading the points a driver has earned.
 *
 * Nothing here calculates anything. Scoring lives entirely in the database
 * (migration 0008) because points decide a monthly payout, and any number the
 * client can compute is a number the client can forge. These functions only
 * read back what the award trigger already decided.
 */

/**
 * Points awarded for one report.
 *
 * The award trigger runs inside the insert's own transaction, so the rows are
 * committed by the time the insert returns -- this never needs to poll or
 * retry.
 *
 * Returns null when the lookup fails, which is deliberately different from 0:
 * zero is a real outcome (a repeat report inside the award cooldown earns
 * nothing) and the two say different things to the driver.
 */
export async function getPointsForReport(reportId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("point_transactions")
      .select("points")
      .eq("report_id", reportId);

    if (error || !data) return null;

    return data.reduce((total, row) => total + row.points, 0);
  } catch {
    return null;
  }
}

/**
 * This device's own totals, or null before the first scored report.
 *
 * No `.eq()` on the user id: `user_points_select_self` (migration 0008) already
 * restricts the table to the caller's own row, so the query can only ever
 * return that one. Filtering here as well would imply the client is what keeps
 * one driver's totals away from another's, which it is not.
 */
export async function getMyPoints(): Promise<UserPointsRow | null> {
  if (isShowcase()) return SHOWCASE_POINTS;

  try {
    const { data, error } = await supabase
      .from("user_points")
      .select("*")
      .maybeSingle();

    if (error) return null;

    return data;
  } catch {
    return null;
  }
}

/** Ids of the badges this device has earned. */
export async function getMyBadges(): Promise<string[]> {
  if (isShowcase()) return SHOWCASE_BADGES;

  try {
    const { data, error } = await supabase.from("badges").select("badge_id");
    if (error || !data) return [];
    return data.map((row) => row.badge_id);
  } catch {
    return [];
  }
}

/**
 * Past monthly champions. Empty until a month has actually been won -- the
 * job that declares winners is phase C and does not exist yet.
 */
export async function getHallOfFame(): Promise<HallOfFameRow[]> {
  if (isShowcase()) return SHOWCASE_WINNERS;

  try {
    const { data, error } = await supabase.rpc("hall_of_fame", {});
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/** This month's standings. Empty until somebody scores. */
export async function getLeaderboard(limit = 100): Promise<LeaderboardRow[]> {
  if (isShowcase()) return showcaseLeaderboard(await getDisplayName());

  try {
    const { data, error } = await supabase.rpc("leaderboard", { max_results: limit });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * The caller's own standing, or null when they have not scored this month.
 * Separate from the list because they are usually outside the visible top 100.
 */
export async function getMyPlace(): Promise<MyPlaceRow | null> {
  if (isShowcase()) return SHOWCASE_MY_PLACE;

  try {
    const { data, error } = await supabase.rpc("my_leaderboard_place", {});
    if (error || !data || data.length === 0) return null;
    return data[0] ?? null;
  } catch {
    return null;
  }
}

/** The caller's chosen leaderboard name, or null if they have not set one. */
export async function getDisplayName(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("display_name")
      .maybeSingle();

    if (error || !data) return null;
    return data.display_name;
  } catch {
    return null;
  }
}

/**
 * Sets the name shown on the leaderboard. Returns an error message to show, or
 * null on success -- the length bound is a database constraint, so a rejection
 * here is the authority rather than a client-side guess.
 */
export async function setDisplayName(name: string): Promise<string | null> {
  const trimmed = name.trim();

  if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
    return `Pick a name between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`;
  }

  try {
    const { data: session } = await supabase.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return "Could not verify your device. Check your connection.";

    const { error } = await supabase
      .from("users")
      .update({ display_name: trimmed })
      .eq("auth_user_id", uid);

    if (error) return "Could not save that name. Please try again.";
    return null;
  } catch {
    return "Could not save that name. Please try again.";
  }
}
