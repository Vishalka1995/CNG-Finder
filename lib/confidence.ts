import { STATUS_COLORS } from "@/constants/colors";
import type { ConfidenceLevel, StationStatus } from "@/types/database";

/**
 * ============================================================================
 * THE CONFIDENCE MODEL -- the heart of the app.
 * ============================================================================
 *
 * A station's "status" is not a fact we own; it is an inference from what
 * drivers told us recently. The model has to answer two questions:
 *
 *   1. WHICH status is currently true?
 *   2. HOW MUCH should the user trust that answer?
 *
 * ---------------------------------------------------------------------------
 * Recency weighting
 * ---------------------------------------------------------------------------
 * CNG availability changes fast -- a station can empty within an hour. So each
 * report is weighted by age rather than counted equally:
 *
 *     <= 10 min -> 1.0   fresh; describes the pump essentially right now
 *     <= 30 min -> 0.5   probably still true
 *     <= 60 min -> 0.1   weak signal, but better than nothing
 *     >  60 min -> 0     ignored entirely
 *
 * The winning status is the one with the highest SUMMED WEIGHT, so a single
 * fresh report outranks several stale ones -- which is the correct behaviour
 * when a station has just run dry.
 *
 * ---------------------------------------------------------------------------
 * Why confidence is graded on weight, not on report count
 * ---------------------------------------------------------------------------
 * The original spec graded confidence by raw count (3+ = high). That produces a
 * concretely misleading result: three reports that are all 55 minutes old carry
 * a combined weight of just 0.3, yet would be labelled "high confidence".
 * Grading on summed weight keeps the label honest -- stale agreement decays to
 * "low" exactly as it should.
 *
 *     >= 1.5  high     (e.g. two fresh reports, or one fresh + several older)
 *     >= 0.6  medium
 *     >  0    low
 *
 * Two special cases sit outside the scale:
 *     'mixed'   -- drivers disagree within the window; we show the leading
 *                  status but flag the disagreement rather than hide it.
 *     'unknown' -- nothing at all in the last 60 minutes.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT: this module is a MIRROR, not the source of truth.
 * ---------------------------------------------------------------------------
 * The authoritative implementation is the `nearby_stations` RPC in
 * supabase/migrations/0001_init.sql. This copy exists so the UI can update
 * optimistically the instant a user submits a report, before the round trip
 * completes. If you change the thresholds here, change them there too --
 * otherwise the marker colour will flicker when the server response arrives.
 * ============================================================================
 */

/** Report age thresholds in minutes, paired with their weights. */
const WEIGHT_BUCKETS: readonly { maxAgeMin: number; weight: number }[] = [
  { maxAgeMin: 10, weight: 1.0 },
  { maxAgeMin: 30, weight: 0.5 },
  { maxAgeMin: 60, weight: 0.1 },
];

const HIGH_THRESHOLD = 1.5;
const MEDIUM_THRESHOLD = 0.6;

export interface WeightedReport {
  status: StationStatus;
  /** ISO timestamp. */
  created_at: string;
}

export interface StatusSummary {
  status: StationStatus | null;
  confidence: ConfidenceLevel;
  reportCount: number;
  lastReportedAt: string | null;
}

/** Weight for a single report, given its age in minutes. */
export function weightForAge(ageMinutes: number): number {
  for (const bucket of WEIGHT_BUCKETS) {
    if (ageMinutes <= bucket.maxAgeMin) return bucket.weight;
  }
  return 0;
}

/**
 * Derives status and confidence from raw reports. Mirrors the SQL in
 * `nearby_stations`; see the module comment above.
 */
export function summarize(reports: WeightedReport[], now: Date = new Date()): StatusSummary {
  const totals = new Map<StationStatus, { weight: number; count: number }>();
  let lastReportedAt: string | null = null;
  let countedReports = 0;

  for (const report of reports) {
    const ageMinutes = (now.getTime() - new Date(report.created_at).getTime()) / 60_000;
    const weight = weightForAge(ageMinutes);
    if (weight === 0) continue;

    const current = totals.get(report.status) ?? { weight: 0, count: 0 };
    totals.set(report.status, {
      weight: current.weight + weight,
      count: current.count + 1,
    });

    countedReports += 1;
    if (!lastReportedAt || report.created_at > lastReportedAt) {
      lastReportedAt = report.created_at;
    }
  }

  if (totals.size === 0) {
    return { status: null, confidence: "unknown", reportCount: 0, lastReportedAt: null };
  }

  let winner: StationStatus | null = null;
  let winnerWeight = -1;
  let totalWeight = 0;

  for (const [status, tally] of totals) {
    totalWeight += tally.weight;
    if (tally.weight > winnerWeight) {
      winnerWeight = tally.weight;
      winner = status;
    }
  }

  // Drivers disagree: surface the leading status but label it honestly.
  if (totals.size > 1) {
    return {
      status: winner,
      confidence: "mixed",
      reportCount: countedReports,
      lastReportedAt,
    };
  }

  const confidence: ConfidenceLevel =
    totalWeight >= HIGH_THRESHOLD
      ? "high"
      : totalWeight >= MEDIUM_THRESHOLD
        ? "medium"
        : "low";

  return { status: winner, confidence, reportCount: countedReports, lastReportedAt };
}

/** Marker / badge colour for a status, falling back to grey when unknown. */
export function colorForStatus(status: StationStatus | null): string {
  if (!status) return STATUS_COLORS.unknown;
  return STATUS_COLORS[status];
}

export function statusLabel(status: StationStatus | null): string {
  switch (status) {
    case "available":
      return "Available";
    case "long_queue":
      return "Long queue";
    case "not_available":
      return "Not available";
    default:
      return "Unknown";
  }
}

export function confidenceLabel(confidence: ConfidenceLevel, reportCount: number): string {
  switch (confidence) {
    case "high":
      return `High confidence -- ${reportCount} recent report${reportCount === 1 ? "" : "s"}`;
    case "medium":
      return `Medium confidence -- ${reportCount} recent report${reportCount === 1 ? "" : "s"}`;
    case "low":
      return "Low confidence -- based on one older report";
    case "mixed":
      return "Mixed reports -- drivers disagree right now";
    default:
      return "No recent reports";
  }
}

/** Relative time for report timestamps: "just now", "15 min ago", "2 h ago". */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";

  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}
