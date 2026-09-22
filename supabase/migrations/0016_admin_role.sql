-- =============================================================================
-- CNG Now -- an admin account for testing and operations.
--
-- Lets a nominated account report any station from anywhere, as often as
-- needed, so the reporting and scoring chain can be exercised without driving
-- to a pump. Admins still need a real session and a real, active station:
-- removing those would only make it easy to create junk data.
--
-- WHY A SEPARATE TABLE RATHER THAN users.is_admin
-- `users_update_self` (0001) lets any signed-in device update its own users
-- row. A boolean column there would therefore be writable by the very person
-- it governs -- one PATCH and anybody is an admin. Membership lives in its own
-- table with no client write access at all, so the only way in is the service
-- role or the SQL editor.
--
-- Admins are excluded from the leaderboard. A test account otherwise sits at
-- the top of a public board, or wins its owner's own prize. It still earns
-- points, so the whole scoring chain stays testable -- they just are not
-- ranked against real drivers.
-- =============================================================================

create table if not exists public.admins (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  -- Who this is and why, for when there is more than one.
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Read-your-own only. Whether YOU are an admin is not a secret -- the client
-- needs it to skip its own proximity check and show the badge. Who ELSE is an
-- admin is nobody's business.
drop policy if exists admins_select_self on public.admins;
create policy admins_select_self
  on public.admins for select
  to authenticated
  using (auth_user_id = auth.uid());

revoke insert, update, delete on public.admins from anon, authenticated;


-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the report trigger and the leaderboard can test any
-- account, not just the caller's own row.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.admins a where a.auth_user_id = p_user
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Report rules, with the two checks an admin skips.
--
-- Replaces the version in 0001. Identical except for steps 3 and 4: the rate
-- limit and the proximity requirement are bypassed for admins, including the
-- requirement to send a location at all, so a report can be made from a desk.
-- Steps 1, 2 and 5 are unchanged and apply to everyone.
-- -----------------------------------------------------------------------------
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
    if new.reported_location is not null then
      new.distance_m := round(ST_Distance(new.reported_location, v_station_loc), 2);
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
-- Leaderboard, with admins filtered out.
--
-- Replaces the versions in 0010. The only change in each is the
-- `not public.is_admin(...)` predicate.
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard(max_results integer default 100)
returns table (
  place        integer,
  driver_name  text,
  driver_city  text,
  points       integer,
  reports      integer,
  is_me        boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with period as (
    select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') as label
  ),
  latest_city as (
    select distinct on (r.auth_user_id)
           r.auth_user_id,
           s.city
      from public.reports r
      join public.stations s on s.id = r.station_id
     order by r.auth_user_id, r.created_at desc
  )
  select
    rank() over (order by up.monthly_points desc)::integer,
    coalesce(
      nullif(btrim(u.display_name), ''),
      'Driver ' || upper(substr(replace(up.auth_user_id::text, '-', ''), 1, 4))
    ),
    lc.city,
    up.monthly_points,
    up.monthly_reports,
    up.auth_user_id = auth.uid()
  from public.user_points up
  cross join period
  left join public.users u       on u.auth_user_id  = up.auth_user_id
  left join latest_city lc       on lc.auth_user_id = up.auth_user_id
  where up.monthly_period = period.label
    and up.monthly_points > 0
    and not public.is_admin(up.auth_user_id)
  order by up.monthly_points desc
  limit max_results;
$$;

create or replace function public.my_leaderboard_place()
returns table (
  place         integer,
  points        integer,
  reports       integer,
  total_drivers integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with period as (
    select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') as label
  ),
  ranked as (
    select up.auth_user_id,
           rank() over (order by up.monthly_points desc) as place,
           up.monthly_points,
           up.monthly_reports
      from public.user_points up
      cross join period
     where up.monthly_period = period.label
       and up.monthly_points > 0
       and not public.is_admin(up.auth_user_id)
  )
  select ranked.place::integer,
         ranked.monthly_points,
         ranked.monthly_reports,
         (select count(*) from ranked)::integer
    from ranked
   where ranked.auth_user_id = auth.uid();
$$;

revoke all on function public.leaderboard(integer) from public, anon;
revoke all on function public.my_leaderboard_place() from public, anon;

grant execute on function public.leaderboard(integer)   to authenticated;
grant execute on function public.my_leaderboard_place() to authenticated;


-- =============================================================================
-- MAKING YOURSELF AN ADMIN
--
-- Your account id is shown in the app: You tab -> tap "Version" -> Session.
-- Paste it below and run:
--
--   insert into public.admins (auth_user_id, note)
--   values ('PASTE-YOUR-SESSION-ID-HERE', 'Vishal -- testing');
--
-- To check it took:
--   select * from public.admins;
--
-- To remove it again:
--   delete from public.admins where auth_user_id = 'PASTE-YOUR-SESSION-ID-HERE';
--
-- NOTE: the id changes if the app is reinstalled, because the account is
-- anonymous until Google sign-in lands. Re-run the insert with the new id.
-- =============================================================================
