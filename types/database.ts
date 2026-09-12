/**
 * Database types.
 *
 * Hand-written to match supabase/migrations/0001_init.sql so the app typechecks
 * before a Supabase project exists. Once the project is live, regenerate with:
 *
 *   npx supabase gen types typescript --project-id <ref> |
 *     Out-File -Encoding utf8 types/database.ts
 *
 * (PowerShell 5.1's `>` writes UTF-16, which TypeScript rejects -- use Out-File.)
 */

export type StationStatus = "available" | "long_queue" | "not_available";

export type ConfidenceLevel = "high" | "medium" | "low" | "mixed" | "unknown";

/** A row as returned by the `nearby_stations` RPC. */
export type NearbyStation = {
  id: string;
  name: string;
  address: string | null;
  area: string | null;
  operator: string | null;
  is_24x7: boolean;
  opening_time: string | null;
  closing_time: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  distance_m: number;
  /** Null when no reports exist in the confidence window. */
  status: StationStatus | null;
  confidence: ConfidenceLevel;
  report_count: number;
  last_reported_at: string | null;
}

/** A row as returned by the `station_reports` RPC. Carries no reporter identity. */
export type StationReport = {
  id: string;
  status: StationStatus;
  note: string | null;
  created_at: string;
}

export type StationRow = {
  id: string;
  name: string;
  address: string | null;
  area: string | null;
  city: string;
  operator: string | null;
  is_24x7: boolean;
  opening_time: string | null;
  closing_time: string | null;
  phone: string | null;
  osm_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type UserRow = {
  id: string;
  auth_user_id: string;
  device_id: string;
  display_name: string | null;
  reports_count: number;
  trust_score: number;
  created_at: string;
  last_seen_at: string;
}

export type FavoriteRow = {
  id: string;
  auth_user_id: string;
  station_id: string;
  created_at: string;
}

export type SubmissionStatus = "pending" | "approved" | "rejected";

export type StationSubmissionRow = {
  id: string;
  auth_user_id: string;
  device_id: string | null;
  name: string;
  operator: string | null;
  address: string | null;
  note: string | null;
  status: SubmissionStatus;
  reviewed_at: string | null;
  review_note: string | null;
  station_id: string | null;
  created_at: string;
};

/**
 * Payload for submitting a station. The server overwrites auth_user_id and
 * forces status to 'pending', so neither is settable here.
 */
export type StationSubmissionInsert = {
  name: string;
  operator?: string | null;
  address?: string | null;
  note?: string | null;
  device_id?: string | null;
  /** WKT point, built with toPointWKT(). */
  location: string;
};

/** Payload for inserting a report. Server overwrites auth_user_id and distance_m. */
export type ReportInsert = {
  station_id: string;
  status: StationStatus;
  note?: string | null;
  device_id?: string | null;
  reported_location: string;
}

/** Why points moved. Mirrors the `point_reason` enum in migration 0008. */
export type PointReason =
  | "base_report"
  | "first_of_day"
  | "peak_hours"
  | "stale_station"
  | "accuracy_bonus"
  | "streak_bonus"
  | "referral_bonus"
  | "accuracy_deduction";

export type PointTransactionRow = {
  id: string;
  auth_user_id: string;
  report_id: string | null;
  station_id: string | null;
  points: number;
  reason: PointReason;
  created_at: string;
}

export type BadgeRow = {
  auth_user_id: string;
  badge_id: string;
  earned_at: string;
}

/** One row of this month's standings. Deliberately carries no auth_user_id --
 *  nothing on screen needs it, and it is the handle to somebody's account. */
export type LeaderboardRow = {
  place: number;
  driver_name: string;
  driver_city: string | null;
  points: number;
  reports: number;
  is_me: boolean;
}

/** One podium place in a past month. Carries nothing that could identify or
 *  pay someone -- see hall_of_fame() in migration 0013. */
export type HallOfFameRow = {
  month: string;
  place: number;
  winner_name: string;
  winner_city: string | null;
  points: number;
  prize: string | null;
}

export type MyPlaceRow = {
  place: number;
  points: number;
  reports: number;
  total_drivers: number;
}

export type UserPointsRow = {
  auth_user_id: string;
  total_points: number;
  monthly_points: number;
  total_reports: number;
  monthly_reports: number;
  /** 'YYYY-MM' in IST, or null before the first scored report. */
  monthly_period: string | null;
  accuracy_score: number | null;
  current_streak: number;
  longest_streak: number;
  last_report_date: string | null;
  updated_at: string;
}

/**
 * Schema shape expected by supabase-js.
 *
 * Three structural requirements, each of which silently collapses the whole
 * schema to `never` (making every insert and rpc call fail to typecheck) if
 * you get it wrong:
 *
 *   1. Every table needs Row / Insert / Update / Relationships.
 *   2. The schema needs `Views`, `Functions`, `Enums` and `CompositeTypes`.
 *   3. Row and payload types above MUST be `type` aliases, not `interface`.
 *      The client constrains them to `Record<string, unknown>`, and TypeScript
 *      interfaces have no implicit index signature, so they fail that check.
 *      This is the non-obvious one -- do not "tidy" them back into interfaces.
 */
export interface Database {
  public: {
    Tables: {
      stations: {
        Row: StationRow;
        Insert: Partial<StationRow> & { name: string };
        Update: Partial<StationRow>;
        Relationships: [];
      };
      users: {
        Row: UserRow;
        Insert: { auth_user_id: string; device_id: string; display_name?: string | null };
        Update: Partial<UserRow>;
        Relationships: [];
      };
      favorites: {
        Row: FavoriteRow;
        Insert: { station_id: string; auth_user_id?: string };
        Update: Partial<FavoriteRow>;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          station_id: string;
          auth_user_id: string;
          device_id: string | null;
          status: StationStatus;
          note: string | null;
          distance_m: number | null;
          created_at: string;
        };
        Insert: ReportInsert;
        // Append-only: the database has no UPDATE policy on reports.
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Update: {};
        Relationships: [];
      };
      station_submissions: {
        Row: StationSubmissionRow;
        Insert: StationSubmissionInsert;
        // Moderation happens with the service role, never from the app.
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Update: {};
        Relationships: [];
      };
      // Both points tables are read-only from the app. The award trigger owns
      // every write and runs as SECURITY DEFINER; the client's INSERT, UPDATE
      // and DELETE grants are revoked outright (migration 0008).
      point_transactions: {
        Row: PointTransactionRow;
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Insert: {};
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Update: {};
        Relationships: [];
      };
      user_points: {
        Row: UserPointsRow;
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Insert: {};
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Update: {};
        Relationships: [];
      };
      badges: {
        Row: BadgeRow;
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Insert: {};
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Update: {};
        Relationships: [];
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    Views: {};
    Functions: {
      nearby_stations: {
        Args: {
          lat: number;
          lng: number;
          radius_m?: number;
          max_results?: number;
        };
        Returns: NearbyStation[];
      };
      station_reports: {
        Args: { station: string; max_results?: number };
        Returns: StationReport[];
      };
      leaderboard: {
        Args: { max_results?: number };
        Returns: LeaderboardRow[];
      };
      my_leaderboard_place: {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        Args: {};
        Returns: MyPlaceRow[];
      };
      hall_of_fame: {
        Args: { max_months?: number };
        Returns: HallOfFameRow[];
      };
    };
    Enums: {
      station_status: StationStatus;
      confidence_level: ConfidenceLevel;
      point_reason: PointReason;
    };
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    CompositeTypes: {};
  };
}
