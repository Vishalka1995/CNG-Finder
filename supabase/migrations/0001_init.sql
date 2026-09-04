-- =============================================================================
-- CNG Now -- initial schema
--
-- Apply in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Committed here so the schema is reproducible and reviewable.
--
-- PREREQUISITE: enable anonymous sign-ins first, at
--   Dashboard -> Authentication -> Providers -> Anonymous.
-- The entire anti-spam model depends on every client holding a real, signed
-- JWT. Without it, inserts into `reports` fail with AUTH_REQUIRED by design.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Part 1: extensions
-- PostGIS is NOT enabled by default on Supabase, and must not live in `public`.
-- -----------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- Verify before continuing; this should return a version string.
-- select postgis_version();


-- -----------------------------------------------------------------------------
-- Part 2: enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.station_status as enum ('available', 'long_queue', 'not_available');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.confidence_level as enum ('high', 'medium', 'low', 'mixed', 'unknown');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- Part 3: users (device registry)
--
-- `device_id` is a client-generated UUID kept in SecureStore. It is USEFUL for
-- analytics and for linking a reinstall back to prior activity, but it is
-- self-asserted and therefore NEVER used for authorization. Authorization keys
-- on `auth_user_id`, which comes from a server-signed JWT the client cannot
-- forge.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique not null references auth.users (id) on delete cascade,
  device_id     text unique not null,
  display_name  text,
  reports_count integer not null default 0,
  -- Scaffolding for weighting reports by reporter reliability in a later phase.
  -- Costs nothing now and saves a migration later.
  trust_score   numeric(4, 2) not null default 1.00,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists users_device_id_idx on public.users (device_id);


-- -----------------------------------------------------------------------------
-- Part 4: stations
--
-- `geography(Point, 4326)` rather than `geometry` so ST_DWithin/ST_Distance
-- take and return METRES directly, with no SRID transform at call sites.
-- -----------------------------------------------------------------------------
create table if not exists public.stations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  area         text,
  city         text not null default 'Bangalore',
  location     geography(Point, 4326) not null,
  operator     text,
  is_24x7      boolean not null default false,
  opening_time time,
  closing_time time,
  phone        text,
  -- Stable OpenStreetMap id, used to make the Phase 4 seed import idempotent.
  osm_id       text unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- GiST index is what makes ST_DWithin and the <-> KNN ordering index-accelerated.
create index if not exists stations_location_gix on public.stations using gist (location);
create index if not exists stations_active_idx on public.stations (is_active) where is_active;


-- -----------------------------------------------------------------------------
-- Part 5: reports
--
-- Append-only ledger. There is deliberately no UPDATE or DELETE policy: the
-- confidence calculation is only trustworthy if history cannot be rewritten.
-- -----------------------------------------------------------------------------
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  station_id        uuid not null references public.stations (id) on delete cascade,
  -- Defaulted at the DB (not the client) and re-asserted by both the trigger
  -- and the RLS WITH CHECK. Three layers, because this is the security boundary.
  auth_user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id         text,
  status            public.station_status not null,
  note              text check (note is null or char_length(note) <= 140),
  reported_location geography(Point, 4326),
  distance_m        numeric(8, 2),
  created_at        timestamptz not null default now()
);

-- The index the confidence query rides on: "reports for station X in the last
-- 60 minutes" becomes an index range scan.
create index if not exists reports_station_created_idx
  on public.reports (station_id, created_at desc);

-- Supports the per-user rate-limit lookup in the trigger.
create index if not exists reports_user_station_created_idx
  on public.reports (auth_user_id, station_id, created_at desc);


-- -----------------------------------------------------------------------------
-- Part 6: favorites
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  station_id   uuid not null references public.stations (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (auth_user_id, station_id)
);

create index if not exists favorites_user_idx on public.favorites (auth_user_id);


-- -----------------------------------------------------------------------------
-- Part 7: anti-spam trigger -- the real enforcement point
--
-- A BEFORE INSERT trigger rather than a pure RLS WITH CHECK subquery because it
-- can (a) raise DISTINGUISHABLE errors so the UI can say "you reported this 12
-- minutes ago" instead of a generic permission denial, (b) compute and persist
-- distance_m in the same pass, and (c) keep the related rules in one readable
-- place. RLS still acts as the coarse gate.
--
-- SECURITY DEFINER is required: the function must read `stations` rows and the
-- caller's prior `reports` that RLS would otherwise hide. The explicit
-- `set search_path` is MANDATORY on a security-definer function -- omitting it
-- is a genuine privilege-escalation vector.
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
begin
  -- 1. Identity comes from the JWT, never from the payload. Overwriting rather
  --    than validating means a forged auth_user_id in the request body is
  --    simply discarded.
  new.auth_user_id := auth.uid();

  if new.auth_user_id is null then
    raise exception 'AUTH_REQUIRED: no authenticated session'
      using errcode = '42501';
  end if;

  -- 2. Station must exist and be active.
  select location into v_station_loc
    from public.stations
   where id = new.station_id
     and is_active;

  if v_station_loc is null then
    raise exception 'STATION_NOT_FOUND: station % is unknown or inactive', new.station_id
      using errcode = '23503';
  end if;

  -- 3. Rate limit: one report per station per user per 30 minutes.
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

  -- 4. Proximity: the reporter must actually be at the station.
  --    300m absorbs typical Bangalore GPS drift (50-100m in dense areas).
  --    The client checks this too, for instant feedback, but this is the
  --    authority -- a client-side check is trivially bypassed.
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

  -- 5. Keep the device registry fresh.
  update public.users
     set last_seen_at  = now(),
         reports_count = reports_count + 1
   where auth_user_id = new.auth_user_id;

  return new;
end;
$$;

drop trigger if exists reports_enforce_rules on public.reports;
create trigger reports_enforce_rules
  before insert on public.reports
  for each row execute function public.enforce_report_rules();


-- -----------------------------------------------------------------------------
-- Part 8: row level security
-- -----------------------------------------------------------------------------
alter table public.stations  enable row level security;
alter table public.reports   enable row level security;
alter table public.users     enable row level security;
alter table public.favorites enable row level security;

-- STATIONS: world-readable, no client writes. Station data is seeded by us via
-- the service role, never by the app.
drop policy if exists stations_select_all on public.stations;
create policy stations_select_all
  on public.stations for select
  to anon, authenticated
  using (is_active);

-- REPORTS: recent window readable by anyone; insert only as yourself.
-- No UPDATE/DELETE policy at all -- append-only by design.
drop policy if exists reports_select_recent on public.reports;
create policy reports_select_recent
  on public.reports for select
  to anon, authenticated
  using (created_at > now() - interval '24 hours');

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self
  on public.reports for insert
  to authenticated
  with check (auth_user_id = auth.uid());

-- USERS: a device may only see and edit its own row.
drop policy if exists users_select_self on public.users;
create policy users_select_self
  on public.users for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
  on public.users for insert
  to authenticated
  with check (auth_user_id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self
  on public.users for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- FAVORITES: fully private per user.
drop policy if exists favorites_all_self on public.favorites;
create policy favorites_all_self
  on public.favorites for all
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- Part 9: nearby_stations RPC
--
-- Returns stations within `radius_m`, nearest first, each carrying its current
-- crowd-sourced status and a confidence grade.
--
-- Query shape matters for performance:
--   * ST_DWithin(...) in WHERE     -> index-accelerated radius filter (metres)
--   * ORDER BY location <-> point  -> KNN index scan
-- Both hit stations_location_gix. A bare `ST_Distance(...) < x` in WHERE would
-- force a sequential scan instead.
--
-- CONFIDENCE MODEL (this is the heart of the app -- see also lib/confidence.ts):
--
--   Each report in the last 60 minutes is weighted by recency:
--       <= 10 min -> 1.0     (fresh; reflects the pump right now)
--       <= 30 min -> 0.5     (probably still true)
--       <= 60 min -> 0.1     (weak signal, better than nothing)
--
--   Winning status = the status with the highest SUMMED WEIGHT, so three
--   stale reports cannot outvote one fresh one.
--
--   Confidence is graded on that same summed weight, NOT on raw report count:
--       >= 1.5  -> high      (e.g. two fresh reports, or equivalent)
--       >= 0.6  -> medium
--       >  0    -> low
--   Grading by count would label three 55-minute-old reports (total weight
--   0.3) as "high confidence", which is exactly the misleading case this
--   design avoids.
--
--   Special cases:
--       more than one distinct status in the window -> 'mixed'
--       no reports in the window                    -> 'unknown'
-- -----------------------------------------------------------------------------
create or replace function public.nearby_stations(
  lat         double precision,
  lng         double precision,
  radius_m    integer default 10000,
  max_results integer default 50
)
returns table (
  id               uuid,
  name             text,
  address          text,
  area             text,
  operator         text,
  is_24x7          boolean,
  opening_time     time,
  closing_time     time,
  phone            text,
  latitude         double precision,
  longitude        double precision,
  distance_m       double precision,
  status           public.station_status,
  confidence       public.confidence_level,
  report_count     integer,
  last_reported_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (
    -- NOTE: ST_MakePoint takes (longitude, latitude) in that order.
    -- Reversing it puts Bangalore in the Indian Ocean.
    select ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography as g
  ),
  near as (
    select s.*, ST_Distance(s.location, o.g) as dist
      from public.stations s, origin o
     where s.is_active
       and ST_DWithin(s.location, o.g, radius_m)
     order by s.location <-> o.g
     limit max_results
  ),
  weighted as (
    select
      r.station_id,
      r.status,
      sum(
        case
          when r.created_at > now() - interval '10 minutes' then 1.0
          when r.created_at > now() - interval '30 minutes' then 0.5
          when r.created_at > now() - interval '60 minutes' then 0.1
          else 0
        end
      ) as weight,
      count(*) as n,
      max(r.created_at) as last_at
    from public.reports r
    where r.created_at > now() - interval '60 minutes'
      and r.station_id in (select id from near)
    group by r.station_id, r.status
  ),
  ranked as (
    select
      station_id, status, weight, n, last_at,
      row_number() over (
        partition by station_id order by weight desc, last_at desc
      ) as rn,
      count(*)   over (partition by station_id) as distinct_statuses,
      sum(n)     over (partition by station_id) as total_reports,
      sum(weight) over (partition by station_id) as total_weight,
      max(last_at) over (partition by station_id) as station_last_at
    from weighted
  ),
  winner as (
    select * from ranked where rn = 1
  )
  select
    n.id,
    n.name,
    n.address,
    n.area,
    n.operator,
    n.is_24x7,
    n.opening_time,
    n.closing_time,
    n.phone,
    -- PostgREST cannot serialize the geography type, so return plain floats.
    ST_Y(n.location::geometry) as latitude,
    ST_X(n.location::geometry) as longitude,
    n.dist as distance_m,
    w.status,
    case
      when w.status is null        then 'unknown'::public.confidence_level
      when w.distinct_statuses > 1 then 'mixed'::public.confidence_level
      when w.total_weight >= 1.5   then 'high'::public.confidence_level
      when w.total_weight >= 0.6   then 'medium'::public.confidence_level
      else                              'low'::public.confidence_level
    end as confidence,
    coalesce(w.total_reports, 0)::integer as report_count,
    w.station_last_at as last_reported_at
  from near n
  left join winner w on w.station_id = n.id
  order by n.dist;
$$;

grant execute on function public.nearby_stations(
  double precision, double precision, integer, integer
) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- Part 10: station_reports RPC -- the "last 5 reports" timeline on the detail
-- screen. Exposes no reporter identity, only status/time/note.
-- -----------------------------------------------------------------------------
create or replace function public.station_reports(
  station uuid,
  max_results integer default 5
)
returns table (
  id         uuid,
  status     public.station_status,
  note       text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select r.id, r.status, r.note, r.created_at
    from public.reports r
   where r.station_id = station
     and r.created_at > now() - interval '24 hours'
   order by r.created_at desc
   limit max_results;
$$;

grant execute on function public.station_reports(uuid, integer) to anon, authenticated;
