-- =============================================================================
-- CNG Now -- fix: admin reports failed with a type error.
--
-- 0016 inlined the distance calculation in the admin branch:
--
--   new.distance_m := round(ST_Distance(...), 2);
--
-- ST_Distance returns double precision, and PostgreSQL has no
-- round(double precision, integer) -- only round(numeric, integer). So every
-- admin report failed with:
--
--   function round(double precision, integer) does not exist   [42883]
--
-- The original 0001 code never hit this because it assigned the result to a
-- `numeric` variable first, which cast it implicitly before rounding. Inlining
-- the call quietly removed that cast.
--
-- Fixed by casting explicitly. The driver path was unaffected -- it still
-- rounds v_distance, which is declared numeric -- so only admins ever saw it.
-- =============================================================================

create or replace function public.enforce_report_rules()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_station_loc geography(Point, 4326);
  v_last_report timestamptz;
  v_distance    numeric;
  v_is_admin    boolean;
begin
  -- 1. Identity comes from the JWT, never from the payload. Overwriting rather
  --    than validating means a forged auth_user_id in the request body is
  --    simply discarded.
  new.auth_user_id := auth.uid();

  if new.auth_user_id is null then
    raise exception 'AUTH_REQUIRED: no authenticated session'
      using errcode = '42501';
  end if;

  v_is_admin := public.is_admin(new.auth_user_id);

  -- 2. Station must exist and be active. Applies to admins too -- reporting a
  --    station that does not exist is not a useful thing to be able to do.
  select location into v_station_loc
    from public.stations
   where id = new.station_id
     and is_active;

  if v_station_loc is null then
    raise exception 'STATION_NOT_FOUND: station % is unknown or inactive', new.station_id
      using errcode = '23503';
  end if;

  -- 3. Rate limit: one report per station per user per 30 minutes.
  if not v_is_admin then
    select max(created_at) into v_last_report
      from public.reports
     where auth_user_id = new.auth_user_id
       and station_id   = new.station_id
       and created_at   > now() - interval '30 minutes';

    if v_last_report is not null then
      raise exception 'RATE_LIMITED: last report at %, retry after %',
        v_last_report, v_last_report + interval '30 minutes'
        using errcode = 'P0001';
    end if;
  end if;

  -- 4. Proximity: the reporter must actually be at the station.
  --    300m absorbs typical Bangalore GPS drift (50-100m in dense areas).
  --    The client checks this too, for instant feedback, but this is the
  --    authority -- a client-side check is trivially bypassed.
  if v_is_admin then
    -- Distance is still recorded when a location was sent, so an admin report
    -- made at a station is indistinguishable from a driver's in the data.
    -- Goes through v_distance, which is numeric, rather than rounding the
    -- double precision ST_Distance returns -- see the header.
    if new.reported_location is not null then
      v_distance := ST_Distance(new.reported_location, v_station_loc);
      new.distance_m := round(v_distance, 2);
    end if;
  else
    if new.reported_location is null then
      raise exception 'LOCATION_REQUIRED: reports must include a location'
        using errcode = 'P0001';
    end if;

    v_distance := ST_Distance(new.reported_location, v_station_loc);

    if v_distance > 300 then
      raise exception 'TOO_FAR: % m from station (limit 300 m)', round(v_distance)
        using errcode = 'P0001';
    end if;

    new.distance_m := round(v_distance, 2);
  end if;

  -- 5. Keep the device registry fresh.
  update public.users
     set last_seen_at  = now(),
         reports_count = reports_count + 1
   where auth_user_id = new.auth_user_id;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Verify: report a station from the app as an admin. It should succeed, and
-- distance_m should be populated when a location was sent:
--
--   select distance_m, created_at from public.reports
--    order by created_at desc limit 5;
-- -----------------------------------------------------------------------------
