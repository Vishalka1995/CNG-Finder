-- =============================================================================
-- CNG Now -- Checkpoint 1 database verification.
-- Run these in the Supabase SQL editor after applying 0001 and 0002.
-- Each block states what a PASS looks like.
-- =============================================================================


-- 1. PostGIS is installed --------------------------------------------------
-- PASS: returns a version string such as "3.3 USE_GEOS=1 ...".
select postgis_version();


-- 2. Seed data landed ------------------------------------------------------
-- PASS: 10
select count(*) as station_count from public.stations;


-- 3. Radius filter and index path are live ---------------------------------
-- PASS: the 5km call returns STRICTLY FEWER rows than the 10km call.
-- If either returns 0 rows, latitude/longitude are swapped somewhere.
select count(*) as within_5km  from public.nearby_stations(12.9716, 77.5946, 5000);
select count(*) as within_10km from public.nearby_stations(12.9716, 77.5946, 10000);

-- Eyeball the ordering and the default status.
-- PASS: ordered by ascending distance_m, every row confidence = 'unknown'
--       (no reports exist yet), report_count = 0.
select name, round(distance_m) as metres, status, confidence, report_count
  from public.nearby_stations(12.9716, 77.5946, 10000)
 limit 10;


-- 4. The GiST index is actually being used ---------------------------------
-- PASS: the plan mentions "Index Scan using stations_location_gix".
-- (On a 10-row table Postgres may still choose a seq scan -- that is fine and
-- expected; re-check this once real seed data is loaded in Phase 4.)
explain analyze
select * from public.nearby_stations(12.9716, 77.5946, 10000);


-- =============================================================================
-- 5. ANTI-SPAM PROOF -- the check people skip and regret.
--
-- The SQL editor runs as a privileged role where auth.uid() is NULL, so the
-- trigger's AUTH_REQUIRED guard fires first and the rate-limit path is never
-- reached. To exercise the real rules we impersonate an authenticated user by
-- setting the request JWT claims for the transaction.
--
-- Run this whole block at once.
-- =============================================================================
do $$
declare
  v_uid     uuid;
  v_station uuid;
  v_loc     geography(Point, 4326);
  v_err     text;
begin
  -- Use any existing auth user; create one via the app first if this fails.
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'SKIPPED: no auth.users row yet. Launch the app once, then re-run.';
    return;
  end if;

  select id, location into v_station, v_loc from public.stations limit 1;

  -- Ensure the users row the trigger updates exists.
  insert into public.users (auth_user_id, device_id)
  values (v_uid, 'verify-script-device')
  on conflict (auth_user_id) do nothing;

  -- Impersonate that user for the remainder of this transaction.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 5a. First report AT the station should SUCCEED.
  begin
    insert into public.reports (station_id, status, reported_location, device_id)
    values (v_station, 'available', v_loc, 'verify-script-device');
    raise notice 'PASS 5a: first report accepted';
  exception when others then
    raise notice 'FAIL 5a: first report rejected -> %', sqlerrm;
  end;

  -- 5b. Immediate second report for the same station must FAIL as RATE_LIMITED.
  begin
    insert into public.reports (station_id, status, reported_location, device_id)
    values (v_station, 'available', v_loc, 'verify-script-device');
    raise notice 'FAIL 5b: duplicate accepted -- the trigger is NOT attached';
  exception when others then
    v_err := sqlerrm;
    if v_err like 'RATE_LIMITED%' then
      raise notice 'PASS 5b: %', v_err;
    else
      raise notice 'FAIL 5b: wrong error -> %', v_err;
    end if;
  end;

  -- 5c. A report ~1km away must FAIL as TOO_FAR.
  begin
    insert into public.reports (station_id, status, reported_location, device_id)
    values (
      (select id from public.stations offset 1 limit 1),
      'available',
      ST_SetSRID(ST_MakePoint(ST_X(v_loc::geometry) + 0.05,
                              ST_Y(v_loc::geometry)), 4326)::geography,
      'verify-script-device'
    );
    raise notice 'FAIL 5c: distant report accepted -- proximity rule not enforced';
  exception when others then
    v_err := sqlerrm;
    if v_err like 'TOO_FAR%' then
      raise notice 'PASS 5c: %', v_err;
    else
      raise notice 'FAIL 5c: wrong error -> %', v_err;
    end if;
  end;

  -- Roll back the test rows so the ledger stays clean.
  raise exception 'VERIFY_COMPLETE: rolling back test data (this is expected)';
exception when others then
  if sqlerrm like 'VERIFY_COMPLETE%' then
    raise notice '%', sqlerrm;
  else
    raise;
  end if;
end $$;


-- =============================================================================
-- 6. RLS PROOF -- must be done OUTSIDE the SQL editor.
--
-- The SQL editor bypasses RLS, so it cannot prove anything here. Use curl or
-- any REST client with the ANON key:
--
--   # Should return station rows (200):
--   curl "$SUPABASE_URL/rest/v1/stations?select=name" \
--        -H "apikey: $ANON_KEY"
--
--   # Should be rejected (401/403) -- the app must never write stations:
--   curl -X POST "$SUPABASE_URL/rest/v1/stations" \
--        -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--        -d '{"name":"hack","city":"Bangalore"}'
--
-- PASS: read succeeds, write is refused. If the write succeeds, RLS is off.
-- =============================================================================
