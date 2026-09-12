import type {
  HallOfFameRow,
  LeaderboardRow,
  MyPlaceRow,
  NearbyStation,
  StationReport,
  StationStatus,
  UserPointsRow,
} from "@/types/database";

/**
 * Showcase mode -- believable data for demonstrating the app.
 *
 * The app is real but nobody has reported yet, so every station reads
 * "unknown" and every board is empty. That is honest, and it is also
 * impossible to show anyone what the thing actually does.
 *
 * This synthesises the missing half ON THE DEVICE ONLY. Nothing here is
 * written to Supabase, for two reasons that matter more than convenience:
 *
 *   1. A fake "available" in the real database sends a real driver to a pump
 *      that has no gas. Trustworthy availability is the entire product.
 *   2. Fake accounts in the real user_points table compete for a real prize.
 *
 * Everything is derived from the station's own id, so a station that shows as
 * available stays available across refreshes and restarts. Demos where the
 * data reshuffles every time you pull down look broken.
 */

/** Stable hash. Same id in, same number out, on every device and every run. */
function hash(value: string): number {
  let h = 0;
  for (let index = 0; index < value.length; index += 1) {
    h = (h * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(h);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Weighted so the map looks like a real city rather than a test fixture:
 * mostly working pumps, a few queues, a few dry, and some with nobody having
 * checked recently. A board of all-green would not demonstrate anything.
 */
function statusFor(stationId: string): StationStatus | null {
  const bucket = hash(stationId) % 20;

  if (bucket < 10) return "available";
  if (bucket < 14) return "long_queue";
  if (bucket < 17) return "not_available";
  return null;
}

/** Layers a synthetic status over a real station, keeping its real identity. */
export function showcaseStation(station: NearbyStation): NearbyStation {
  const status = statusFor(station.id);

  if (status === null) {
    return { ...station, status: null, confidence: "unknown", report_count: 0, last_reported_at: null };
  }

  const seed = hash(station.id);
  const reportCount = 1 + (seed % 5);
  const ageMinutes = 3 + (seed % 47);

  return {
    ...station,
    status,
    confidence: ageMinutes < 12 ? "high" : ageMinutes < 30 ? "medium" : "low",
    report_count: reportCount,
    last_reported_at: minutesAgo(ageMinutes),
  };
}

/** Metres the nearest station is placed at in showcase mode. Inside the 300 m
 *  reporting radius, and not suspiciously round. */
const SHOWCASE_AT_STATION_M = 80;

/** Points the showcase report claims to award. The figure a real first report
 *  at a quiet Kolhapur station earns: (5 + 10 + 12) x 1.5. */
export const SHOWCASE_REPORT_POINTS = 41;

export function showcaseStations(stations: NearbyStation[]): NearbyStation[] {
  const shown = stations.map(showcaseStation);
  if (shown.length === 0) return shown;

  // Put the driver AT the closest station. Statuses alone are not enough for a
  // demo: the prompt to report, and reporting itself, are both gated on being
  // within 300 m, so without this the most important half of the app cannot be
  // shown from a desk.
  let nearestIndex = 0;
  for (let index = 1; index < shown.length; index += 1) {
    if ((shown[index]?.distance_m ?? Infinity) < (shown[nearestIndex]?.distance_m ?? Infinity)) {
      nearestIndex = index;
    }
  }

  const nearest = shown[nearestIndex];
  if (nearest) {
    shown[nearestIndex] = {
      ...nearest,
      distance_m: SHOWCASE_AT_STATION_M,
      // Being at a station with no recent report is the case worth
      // demonstrating: it is what the prompt is asking you to fix.
      status: null,
      confidence: "unknown",
      report_count: 0,
      last_reported_at: null,
    };
  }

  return shown;
}

const NOTES = [
  null,
  "Short queue, moving fast",
  "Both machines working",
  "About 15 min wait",
  null,
  "Pump closed for maintenance",
];

/** A plausible recent history for the station detail timeline. */
export function showcaseReports(stationId: string): StationReport[] {
  const status = statusFor(stationId);
  if (status === null) return [];

  const seed = hash(stationId);
  const count = 2 + (seed % 3);

  return Array.from({ length: count }, (_, index) => {
    // The newest report agrees with the station's current status; older ones
    // drift, which is what gives the confidence grading something to do.
    const entryStatus: StationStatus =
      index === 0 ? status : (seed + index) % 3 === 0 ? "long_queue" : status;

    return {
      id: `showcase-${stationId}-${index}`,
      status: entryStatus,
      note: NOTES[(seed + index) % NOTES.length] ?? null,
      created_at: minutesAgo(4 + index * 23 + (seed % 7)),
    };
  });
}

/** The demo driver's own totals. Internally consistent with SHOWCASE_BADGES:
 *  142 lifetime reports earns Century, a 4-day streak does not earn On Fire. */
export const SHOWCASE_POINTS: UserPointsRow = {
  auth_user_id: "showcase",
  total_points: 1840,
  monthly_points: 380,
  total_reports: 142,
  monthly_reports: 24,
  monthly_period: null,
  accuracy_score: 87,
  current_streak: 4,
  longest_streak: 11,
  last_report_date: null,
  updated_at: new Date().toISOString(),
};

export const SHOWCASE_BADGES = ["first_report", "early_bird", "city_scout", "century"];

const DRIVERS: { name: string; city: string; points: number; reports: number }[] = [
  { name: "Ramesh K", city: "Bangalore", points: 1240, reports: 78 },
  { name: "Suresh M", city: "Kolhapur", points: 980, reports: 61 },
  { name: "Priya N", city: "Kolhapur", points: 820, reports: 54 },
  { name: "Anil Deshmukh", city: "Kolhapur", points: 640, reports: 43 },
  { name: "Fatima S", city: "Bangalore", points: 515, reports: 36 },
  { name: "Vikram J", city: "Kolhapur", points: 442, reports: 31 },
  { name: "Sandeep R", city: "Bangalore", points: 310, reports: 22 },
  { name: "Meera P", city: "Kolhapur", points: 268, reports: 19 },
  { name: "Irfan A", city: "Bangalore", points: 201, reports: 15 },
  { name: "Kavita B", city: "Kolhapur", points: 154, reports: 12 },
  { name: "Joseph T", city: "Bangalore", points: 96, reports: 8 },
];

/** Where the demo driver sits. Mid-table on purpose: a demo that opens on
 *  "you are #1" never shows the climb, which is the part that motivates. */
const MY_PLACE = 7;

export function showcaseLeaderboard(myName: string | null): LeaderboardRow[] {
  const rows: LeaderboardRow[] = DRIVERS.map((driver, index) => ({
    place: index + 1,
    driver_name: driver.name,
    driver_city: driver.city,
    points: driver.points,
    reports: driver.reports,
    is_me: false,
  }));

  rows.splice(MY_PLACE - 1, 0, {
    place: MY_PLACE,
    driver_name: myName ?? "You",
    driver_city: "Kolhapur",
    points: SHOWCASE_POINTS.monthly_points,
    reports: SHOWCASE_POINTS.monthly_reports,
    is_me: true,
  });

  return rows.map((row, index) => ({ ...row, place: index + 1 }));
}

/**
 * Past podiums. Three months, because one month does not read as a recurring
 * competition and recurring is the whole idea. Prizes match the intended
 * ladder: 10kg / 5kg / 3kg.
 */
export const SHOWCASE_WINNERS: HallOfFameRow[] = [
  { month: "2026-08", place: 1, winner_name: "Ramesh K", winner_city: "Bangalore", points: 1240, prize: "10kg CNG free" },
  { month: "2026-08", place: 2, winner_name: "Suresh M", winner_city: "Kolhapur", points: 1105, prize: "5kg CNG free" },
  { month: "2026-08", place: 3, winner_name: "Priya N", winner_city: "Kolhapur", points: 940, prize: "3kg CNG free" },

  { month: "2026-07", place: 1, winner_name: "Suresh M", winner_city: "Kolhapur", points: 980, prize: "10kg CNG free" },
  { month: "2026-07", place: 2, winner_name: "Anil Deshmukh", winner_city: "Kolhapur", points: 870, prize: "5kg CNG free" },
  { month: "2026-07", place: 3, winner_name: "Fatima S", winner_city: "Bangalore", points: 690, prize: "3kg CNG free" },

  { month: "2026-06", place: 1, winner_name: "Priya N", winner_city: "Kolhapur", points: 820, prize: "10kg CNG free" },
  { month: "2026-06", place: 2, winner_name: "Vikram J", winner_city: "Kolhapur", points: 745, prize: "5kg CNG free" },
  { month: "2026-06", place: 3, winner_name: "Ramesh K", winner_city: "Bangalore", points: 612, prize: "3kg CNG free" },
];

export const SHOWCASE_MY_PLACE: MyPlaceRow = {
  place: MY_PLACE,
  points: SHOWCASE_POINTS.monthly_points,
  reports: SHOWCASE_POINTS.monthly_reports,
  total_drivers: DRIVERS.length + 1,
};
