import { BANGALORE_CENTER } from "@/constants/config";
import { summarize } from "@/lib/confidence";
import { distanceMeters, type Coords } from "@/lib/location";
import type { NearbyStation, StationReport, StationStatus } from "@/types/database";

/**
 * Demo data.
 *
 * Active only while Supabase is unconfigured (see `isDemoMode` in
 * constants/config.ts), so the app is fully explorable before any account
 * exists. It disables itself the moment real keys land in `.env` -- there is no
 * flag to remember to switch off.
 *
 * The statuses and ages below are chosen to exercise every visual state: high,
 * medium, low, mixed and unknown confidence, plus all three status colours.
 */

/** Minutes-ago to ISO timestamp, so demo ages stay relative to when you look. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

type DemoSeed = {
  id: string;
  name: string;
  address: string;
  area: string;
  operator: string;
  is_24x7: boolean;
  phone: string | null;
  latitude: number;
  longitude: number;
  /** Reports inside the 60-minute confidence window, newest first. */
  reports: { status: StationStatus; note: string | null; minutesAgo: number }[];
};

const SEEDS: DemoSeed[] = [
  {
    id: "demo-001",
    name: "Indian Oil CNG - Koramangala",
    address: "80 Feet Road, Koramangala 4th Block",
    area: "Koramangala",
    operator: "Indian Oil",
    is_24x7: true,
    phone: "+918041234567",
    latitude: 12.9345,
    longitude: 77.6245,
    // Three fresh agreeing reports -> available, high confidence.
    reports: [
      { status: "available", note: "No queue at all", minutesAgo: 4 },
      { status: "available", note: null, minutesAgo: 9 },
      { status: "available", note: "Both pumps working", minutesAgo: 14 },
    ],
  },
  {
    id: "demo-002",
    name: "HP CNG - Indiranagar",
    address: "100 Feet Road, Indiranagar",
    area: "Indiranagar",
    operator: "HP",
    is_24x7: true,
    phone: "+918042345678",
    latitude: 12.9784,
    longitude: 77.6408,
    // Fresh and agreeing -> long queue, high confidence.
    reports: [
      { status: "long_queue", note: "About 20 minutes wait", minutesAgo: 6 },
      { status: "long_queue", note: null, minutesAgo: 11 },
    ],
  },
  {
    id: "demo-003",
    name: "BPCL CNG - Whitefield",
    address: "Whitefield Main Road",
    area: "Whitefield",
    operator: "BPCL",
    is_24x7: false,
    phone: null,
    latitude: 12.9698,
    longitude: 77.75,
    // Fresh and agreeing -> not available, high confidence.
    reports: [
      { status: "not_available", note: "Pump shut, no gas", minutesAgo: 3 },
      { status: "not_available", note: null, minutesAgo: 12 },
    ],
  },
  {
    id: "demo-004",
    name: "Indian Oil CNG - Electronic City",
    address: "Hosur Road, Electronic City Phase 1",
    area: "Electronic City",
    operator: "Indian Oil",
    is_24x7: true,
    phone: "+918043456789",
    latitude: 12.8452,
    longitude: 77.66,
    // Drivers disagree -> mixed.
    reports: [
      { status: "available", note: "Just filled up", minutesAgo: 5 },
      { status: "long_queue", note: "Long line now", minutesAgo: 8 },
    ],
  },
  {
    id: "demo-005",
    name: "HP CNG - Jayanagar",
    address: "4th Block, Jayanagar",
    area: "Jayanagar",
    operator: "HP",
    is_24x7: false,
    phone: "+918044567890",
    latitude: 12.925,
    longitude: 77.5833,
    // Two mid-age agreeing reports -> weight 1.0 -> medium confidence.
    // A single report can never reach medium: the buckets only yield 1.0, 0.5
    // or 0.1, and the medium threshold is 0.6.
    reports: [
      { status: "available", note: null, minutesAgo: 20 },
      { status: "available", note: "Short wait", minutesAgo: 26 },
    ],
  },
  {
    id: "demo-006",
    name: "BPCL CNG - Hebbal",
    address: "Bellary Road, Hebbal",
    area: "Hebbal",
    operator: "BPCL",
    is_24x7: true,
    phone: null,
    latitude: 13.0358,
    longitude: 77.5946,
    // One stale report -> low confidence.
    reports: [{ status: "available", note: "Was fine earlier", minutesAgo: 48 }],
  },
  {
    id: "demo-007",
    name: "Indian Oil CNG - Marathahalli",
    address: "Outer Ring Road, Marathahalli",
    area: "Marathahalli",
    operator: "Indian Oil",
    is_24x7: true,
    phone: "+918045678901",
    latitude: 12.9591,
    longitude: 77.6974,
    // No recent reports -> unknown, grey marker.
    reports: [],
  },
  {
    id: "demo-008",
    name: "HP CNG - Rajajinagar",
    address: "Dr Rajkumar Road, Rajajinagar",
    area: "Rajajinagar",
    operator: "HP",
    is_24x7: false,
    phone: null,
    latitude: 12.9915,
    longitude: 77.556,
    reports: [],
  },
  {
    id: "demo-009",
    name: "BPCL CNG - Banashankari",
    address: "Kanakapura Road, Banashankari",
    area: "Banashankari",
    operator: "BPCL",
    is_24x7: true,
    phone: "+918046789012",
    latitude: 12.925,
    longitude: 77.573,
    reports: [{ status: "long_queue", note: null, minutesAgo: 35 }],
  },
  {
    id: "demo-010",
    name: "Indian Oil CNG - Yeshwanthpur",
    address: "Tumkur Road, Yeshwanthpur",
    area: "Yeshwanthpur",
    operator: "Indian Oil",
    is_24x7: true,
    phone: null,
    latitude: 13.028,
    longitude: 77.554,
    reports: [{ status: "not_available", note: "Ran out", minutesAgo: 18 }],
  },
];

/**
 * Reports added during this session, keyed by station id. In-memory only: a
 * reload starts clean, which is the right behaviour for throwaway demo data.
 */
const sessionReports = new Map<string, StationReport[]>();

/** Records a report so the timeline and status reflect it immediately. */
export function addDemoReport(
  stationId: string,
  status: StationStatus,
  note: string | null,
): void {
  const existing = sessionReports.get(stationId) ?? [];
  sessionReports.set(stationId, [
    {
      id: `demo-report-${Date.now()}`,
      status,
      note,
      created_at: new Date().toISOString(),
    },
    ...existing,
  ]);
}

/** True when this session already reported the station -- mirrors the rate limit. */
export function hasDemoReport(stationId: string): boolean {
  return (sessionReports.get(stationId)?.length ?? 0) > 0;
}

/** All reports for a station: session-added first, then the seeded ones. */
export function getDemoReports(stationId: string): StationReport[] {
  const seed = SEEDS.find((entry) => entry.id === stationId);
  const seeded: StationReport[] = (seed?.reports ?? []).map((report, index) => ({
    id: `${stationId}-seed-${index}`,
    status: report.status,
    note: report.note,
    created_at: minutesAgo(report.minutesAgo),
  }));

  return [...(sessionReports.get(stationId) ?? []), ...seeded];
}

/**
 * Demo equivalent of the `nearby_stations` RPC. Uses the same `summarize()` as
 * the rest of the UI, so demo confidence behaves exactly like the real thing.
 */
export function getDemoStations(origin: Coords): NearbyStation[] {
  return SEEDS.map((seed): NearbyStation => {
    const summary = summarize(getDemoReports(seed.id));

    return {
      id: seed.id,
      name: seed.name,
      address: seed.address,
      area: seed.area,
      operator: seed.operator,
      is_24x7: seed.is_24x7,
      opening_time: seed.is_24x7 ? null : "06:00:00",
      closing_time: seed.is_24x7 ? null : "22:00:00",
      phone: seed.phone,
      latitude: seed.latitude,
      longitude: seed.longitude,
      distance_m: distanceMeters(origin, {
        latitude: seed.latitude,
        longitude: seed.longitude,
      }),
      status: summary.status,
      confidence: summary.confidence,
      report_count: summary.reportCount,
      last_reported_at: summary.lastReportedAt,
    };
  }).sort((a, b) => a.distance_m - b.distance_m);
}

/** Coordinates of a demo station, for the report screen distance check. */
export function getDemoStationCoords(stationId: string): Coords | null {
  const seed = SEEDS.find((entry) => entry.id === stationId);
  if (!seed) return null;
  return { latitude: seed.latitude, longitude: seed.longitude };
}

/** Fallback origin when real location is unavailable. */
export const DEMO_ORIGIN: Coords = { ...BANGALORE_CENTER };
