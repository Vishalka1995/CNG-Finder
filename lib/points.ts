import { supabase } from "@/lib/supabase";
import type { UserPointsRow } from "@/types/database";

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
