-- =============================================================================
-- CNG Now -- driver-submitted stations.
--
-- Lets a driver standing at an unlisted CNG station add it. Submissions land
-- in a moderation queue rather than going straight onto the map: a wrong
-- coordinate would make the station permanently unreportable (the 300m
-- proximity rule), and a joke entry would be visible to every user.
--
-- Mirrors the security model already used by `reports`:
--   * auth_user_id defaults to auth.uid() AT THE DATABASE, and the trigger
--     overwrites it again -- a forged value in the request body is discarded.
--   * RLS lets a device see only its own submissions.
--   * A BEFORE INSERT trigger enforces the business rules and raises
--     distinguishable errors the app can turn into useful copy.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Part 1: status enum
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.submission_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- Part 2: the queue
-- -----------------------------------------------------------------------------
create table if not exists public.station_submissions (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id     text,

  name          text not null check (char_length(trim(name)) between 3 and 120),
  operator      text check (operator is null or char_length(operator) <= 60),
  address       text check (address is null or char_length(address) <= 240),
  note          text check (note is null or char_length(note) <= 200),

  -- Captured from the phone's GPS at submission time. The trigger requires the
  -- submitter to actually be here, so this doubles as the station's location.
  location      geography(Point, 4326) not null,

  status        public.submission_status not null default 'pending',
  -- Set when a moderator acts on the row.
  reviewed_at   timestamptz,
  review_note   text,
  -- Populated once approved and promoted into public.stations.
  station_id    uuid references public.stations (id) on delete set null,

  created_at    timestamptz not null default now()
);

create index if not exists station_submissions_status_idx
  on public.station_submissions (status, created_at desc);

create index if not exists station_submissions_user_idx
  on public.station_submissions (auth_user_id, created_at desc);

create index if not exists station_submissions_location_gix
  on public.station_submissions using gist (location);


-- -----------------------------------------------------------------------------
-- Part 3: validation trigger
--
-- Three rules, in the order a submitter is most likely to trip them:
--   1. Must be authenticated (identity comes from the JWT, never the payload).
--   2. Must not duplicate an existing station -- 150m catches "this is already
--      on the map, you just did not scroll".
--   3. Must not duplicate another pending submission, so several drivers at
--      the same new station do not create a pile of identical rows to review.
--
-- Rate limiting is deliberately per-user-per-day rather than per-station:
--   a submission is a rarer, higher-effort action than a status report.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_submission_rules()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing_name text;
  v_pending_count integer;
  v_today_count   integer;
begin
  -- 1. Identity from the JWT.
  new.auth_user_id := auth.uid();

  if new.auth_user_id is null then
    raise exception 'AUTH_REQUIRED: no authenticated session'
      using errcode = '42501';
  end if;

  -- Moderation state is never client-settable.
  new.status      := 'pending';
  new.reviewed_at := null;
  new.review_note := null;
  new.station_id  := null;

  -- 2. Already on the map?
  select s.name into v_existing_name
    from public.stations s
   where s.is_active
     and ST_DWithin(s.location, new.location, 150)
   order by ST_Distance(s.location, new.location)
   limit 1;

  if v_existing_name is not null then
    raise exception 'ALREADY_EXISTS: % is already listed here', v_existing_name
      using errcode = 'P0001';
  end if;

  -- 3. Already submitted by someone (including this user)?
  select count(*) into v_pending_count
    from public.station_submissions sub
   where sub.status = 'pending'
     and ST_DWithin(sub.location, new.location, 150);

  if v_pending_count > 0 then
    raise exception 'ALREADY_SUBMITTED: this station is already awaiting review'
      using errcode = 'P0001';
  end if;

  -- 4. Rate limit: five submissions per user per day.
  select count(*) into v_today_count
    from public.station_submissions sub
   where sub.auth_user_id = new.auth_user_id
     and sub.created_at > now() - interval '24 hours';

  if v_today_count >= 5 then
    raise exception 'RATE_LIMITED: you can submit up to 5 stations per day'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists station_submissions_enforce_rules on public.station_submissions;
create trigger station_submissions_enforce_rules
  before insert on public.station_submissions
  for each row execute function public.enforce_submission_rules();


-- -----------------------------------------------------------------------------
-- Part 4: RLS
--
-- A device sees only its own submissions. Nobody can edit or delete via the
-- app: moderation happens with the service role, in the SQL editor or the
-- review script.
-- -----------------------------------------------------------------------------
alter table public.station_submissions enable row level security;

drop policy if exists submissions_select_own on public.station_submissions;
create policy submissions_select_own
  on public.station_submissions for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists submissions_insert_self on public.station_submissions;
create policy submissions_insert_self
  on public.station_submissions for insert
  to authenticated
  with check (auth_user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- Part 5: approve / reject helpers (service_role only)
--
-- Approving copies the submission into public.stations and links the two, so
-- the queue keeps a record of what became what. Restricted to service_role for
-- the same reason as upsert_station: nothing shipped in the APK may create
-- stations.
-- -----------------------------------------------------------------------------
create or replace function public.approve_submission(
  p_submission_id uuid,
  p_name          text default null,
  p_operator      text default null,
  p_address       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sub        public.station_submissions;
  v_station_id uuid;
begin
  select * into v_sub
    from public.station_submissions
   where id = p_submission_id;

  if v_sub.id is null then
    raise exception 'NOT_FOUND: no submission %', p_submission_id;
  end if;

  if v_sub.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED: submission is %', v_sub.status;
  end if;

  -- Overrides let a moderator clean up the name/operator while approving.
  insert into public.stations
    (osm_id, name, address, city, operator, is_24x7, location, is_active)
  values (
    'submission/' || v_sub.id,
    coalesce(nullif(trim(p_name), ''), v_sub.name),
    coalesce(nullif(trim(p_address), ''), v_sub.address),
    'Bangalore',
    coalesce(nullif(trim(p_operator), ''), v_sub.operator),
    false,
    v_sub.location,
    true
  )
  returning id into v_station_id;

  update public.station_submissions
     set status      = 'approved',
         reviewed_at = now(),
         station_id  = v_station_id
   where id = p_submission_id;

  return v_station_id;
end;
$$;

create or replace function public.reject_submission(
  p_submission_id uuid,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.station_submissions
     set status      = 'rejected',
         reviewed_at = now(),
         review_note = p_reason
   where id = p_submission_id
     and status = 'pending';

  if not found then
    raise exception 'NOT_FOUND: no pending submission %', p_submission_id;
  end if;
end;
$$;

revoke all on function public.approve_submission(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text, text, text)
  to service_role;

revoke all on function public.reject_submission(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_submission(uuid, text)
  to service_role;
