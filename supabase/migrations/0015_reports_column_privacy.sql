-- =============================================================================
-- CNG Now -- stop publishing who reported, and from exactly where.
--
-- THE PROBLEM
-- reports_select_recent (0001) lets anon and authenticated read every report
-- from the last 24 hours. Row level security controls WHICH ROWS are visible,
-- not which columns, and SELECT was granted on the whole table -- so that
-- policy also handed out `auth_user_id`, `device_id` and `reported_location`.
--
-- The anon key ships inside the APK, so this was readable by anybody:
--
--   GET /rest/v1/reports?select=auth_user_id,device_id,reported_location,created_at
--
-- Each row says which account, which device, the precise coordinates they
-- stood at, and when. Several rows say where that person drove during the day.
-- Verified against the live project: the request returns 200, not a permission
-- error -- it is empty today only because no reports exist yet.
--
-- THE FIX
-- Column-level grants. The app only ever needed the four columns the timeline
-- shows; the rest exist for the anti-abuse trigger and for auditing a prize,
-- which run as SECURITY DEFINER and are unaffected by what the client may read.
--
-- Unaffected, all checked against their definitions:
--   * station_reports()      -- selects id, status, note, created_at
--   * nearby_stations()      -- selects station_id, status, created_at
--   * inserting a report     -- RETURNING id, still granted
--   * enforce_report_rules() -- SECURITY DEFINER, runs as owner
--   * award_report_points(), award_badges() -- likewise
-- =============================================================================

revoke select on public.reports from anon, authenticated;

grant select (id, station_id, status, note, created_at)
  on public.reports
  to anon, authenticated;


-- -----------------------------------------------------------------------------
-- Verify (run manually). The first should succeed, the second must fail:
--
--   select id, station_id, status, created_at from public.reports limit 1;
--   select device_id from public.reports limit 1;   -- expect: permission denied
--
-- Or against the REST API with the anon key -- this must now return 401/403
-- rather than 200:
--   /rest/v1/reports?select=auth_user_id,device_id,reported_location
-- -----------------------------------------------------------------------------
