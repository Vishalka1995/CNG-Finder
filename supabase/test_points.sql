-- =============================================================================
-- CNG Now -- points trigger test harness.
--
-- Verifies award_report_points() (migration 0008) without anyone having to
-- drive to a station. Run the whole file in the Supabase SQL editor.
--
-- WHY THIS RATHER THAN REPORTING FROM THE APP:
-- enforce_report_rules() rejects any report more than 300 m from the station,
-- which is the whole point of that rule -- so testing from a desk means either
-- faking a GPS position through the API, or going around the client entirely.
-- This does the latter. It inserts through the real `reports` table, so BOTH
-- triggers run exactly as they do in production; only the source of the
-- location differs.
--
-- IT ROLLS BACK. Nothing is left behind: no report, no points, no altered
-- station status. That matters because a committed test report would show the
-- station as "available" to real drivers for the next 60 minutes, and would
-- leave points on a real account.
--
-- To keep the data instead (e.g. to see points in the app UI), change the
-- final ROLLBACK to COMMIT -- but then pick a station you do not mind
-- showing a fake status for an hour.
--
-- Safe to re-run: because it rolls back, the 30-minute report cooldown and the
-- 2-hour award cooldown never see a previous run.
-- =============================================================================

begin;

do $$
declare
  v_user     uuid;
  v_station  uuid;
  v_name     text;
  v_city     text;
  v_loc      geography;
begin
  -- Any existing account. Anonymous sign-in creates one the first time the
  -- app is opened, so there should be at least one already.
  select auth_user_id into v_user
    from public.users
   order by created_at
   limit 1;

  if v_user is null then
    raise exception
      'No accounts yet -- open the app once so anonymous sign-in creates one.';
  end if;

  -- Kolhapur, so the 1.5x multiplier is exercised too. Reporting AT the
  -- station's own coordinates makes the distance 0 m.
  select s.id, s.name, s.city, s.location
    into v_station, v_name, v_city, v_loc
    from public.stations s
   where s.city = 'Kolhapur'
     and s.is_active
   order by s.name
   limit 1;

  if v_station is null then
    raise exception 'No active Kolhapur stations found.';
  end if;

  raise notice 'Reporting as % at % (%)', v_user, v_name, v_city;

  -- Make auth.uid() resolve, exactly as a signed-in client would. Scoped to
  -- this transaction only.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user)::text,
    true
  );

  insert into public.reports (station_id, status, note, device_id, reported_location)
  values (v_station, 'available', 'points trigger test', 'sql-test', v_loc);
end
$$;


-- 1. What the trigger awarded, broken down. These rows must sum to the
--    balance in step 2.
select reason, points
  from public.point_transactions
 order by created_at desc, reason;

-- 2. The running totals.
select total_points,
       monthly_points,
       monthly_period,
       total_reports,
       monthly_reports,
       current_streak,
       last_report_date
  from public.user_points;

-- 3. Reconciliation -- these two numbers must match.
select (select coalesce(sum(points), 0) from public.point_transactions) as logged,
       (select coalesce(sum(total_points), 0) from public.user_points)  as balance;

rollback;

-- Expected for a first report at a quiet Kolhapur station:
--   base_report    5 x 1.5 =  8   (round-half-up on .5)
--   first_of_day  10 x 1.5 = 15
--   stale_station 12 x 1.5 = 18
--   peak_hours     8 x 1.5 = 12   only if run 6-10am or 5-8pm IST
--   -------------------------------
--   total        41, or 53 during peak hours
--
-- If NOTHING is awarded, the trigger swallowed an error by design so the
-- report still saved. Look in Supabase -> Logs -> Postgres for
-- 'award_report_points failed'.
