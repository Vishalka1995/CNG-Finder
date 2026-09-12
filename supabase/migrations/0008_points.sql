-- =============================================================================
-- CNG Now -- points scoring (gamification phase A).
--
-- Adds the scoring substrate only: tables, the award trigger, and the city
-- multiplier. No leaderboard, no badges, no prize -- those come later and need
-- nothing from the client that is not already here.
--
-- IDENTITY: everything keys on `auth_user_id`, NOT `device_id`.
-- The spec this came from keyed on device_id, but device_id is supplied by the
-- client and the anon key is extractable from the APK, so any device can claim
-- to be any other. That was already the reason enforce_report_rules() (0001)
-- overwrites auth_user_id from auth.uid() and treats device_id as analytics
-- only. Once points decide who receives a monthly cash-equivalent prize, a
-- forgeable key is a payout exploit, and re-keying after points accumulate
-- means migrating history and possibly invalidating a past winner. So it is
-- settled here, before the first point is awarded.
--
-- WHY A TRIGGER RATHER THAN AN EDGE FUNCTION: the report rules already live in
-- the database (0001), which makes the database the authority. Awarding in the
-- same transaction as the insert keeps the two atomic, needs no deployment
-- step, and has no cold start. Edge Functions are still the right tool later
-- for work that must call outward (push notifications).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Part 1: reason codes
--
-- Every reason is declared now, including ones no code awards yet, because
-- adding a value to an enum cannot run inside the same transaction as code
-- that uses it -- defining them up front saves a fiddly migration per phase.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'point_reason') then
    create type public.point_reason as enum (
      'base_report',         -- submitted a report
      'first_of_day',        -- first report at this station today
      'peak_hours',          -- reported 6-10am or 5-8pm IST
      'stale_station',       -- station had no report for 2+ hours
      'accuracy_bonus',      -- later phase: confirmed by following reports
      'streak_bonus',        -- later phase: 7-day reporting streak
      'referral_bonus',      -- later phase
      'accuracy_deduction'   -- later phase: contradicted by following reports
    );
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- Part 2: city multipliers
--
-- A driver in Kolhapur (31 stations) cannot out-report one in Bangalore (97)
-- on volume alone, so points are scaled by the city of the station reported.
-- Keyed on the STATION's city, not the user's: we already store that
-- (stations.city, added in 0007) and it needs no profile data to work.
--
-- Deliberately a table rather than a constant: tuning fairness is a row update,
-- not an app release. Unknown cities fall back to 1.0.
-- -----------------------------------------------------------------------------
create table if not exists public.city_multipliers (
  city          text primary key,
  multiplier    numeric(4, 2) not null default 1.00 check (multiplier > 0),
  station_count integer,
  updated_at    timestamptz not null default now()
);

-- Counts reflect the live table at the time of writing; multipliers are a
-- judgement call, not a formula, and are meant to be tuned in place.
insert into public.city_multipliers (city, multiplier, station_count) values
  ('Bangalore', 1.00, 97),
  ('Kolhapur',  1.50, 31)
on conflict (city) do nothing;


-- -----------------------------------------------------------------------------
-- Part 3: per-user totals
--
-- `monthly_period` ('YYYY-MM', IST) is what makes the monthly reset safe. The
-- spec relied on a cron job zeroing every row at midnight on the 1st; if that
-- job is late, fails, or is retried, last month's points silently contaminate
-- the new month's standings -- and the standings decide a payout. Storing the
-- period each total belongs to means the reset happens lazily and correctly on
-- the row's next write, whether or not any job ran.
-- -----------------------------------------------------------------------------
create table if not exists public.user_points (
  auth_user_id     uuid primary key references auth.users (id) on delete cascade,
  total_points     integer not null default 0,   -- lifetime, never reset
  monthly_points   integer not null default 0,
  total_reports    integer not null default 0,
  monthly_reports  integer not null default 0,
  monthly_period   text,                         -- 'YYYY-MM' in IST
  -- Null until a later phase actually measures accuracy. Defaulting to 0.0
  -- would read as "0% accurate" for everyone who has never been checked.
  accuracy_score   numeric(5, 2),
  current_streak   integer not null default 0,
  longest_streak   integer not null default 0,
  last_report_date date,                         -- IST calendar date
  updated_at       timestamptz not null default now()
);

-- The leaderboard query's index: "this month's rows, highest first".
create index if not exists user_points_monthly_idx
  on public.user_points (monthly_period, monthly_points desc);

-- These count SCORED reports, which is not the same as every report submitted:
-- a repeat report at the same station inside the award cooldown still saves,
-- and still helps other drivers, but does not increment these. The raw count
-- lives on users.reports_count. Keeping the scored count next to the points
-- means the two always tell the same story.
comment on column public.user_points.total_reports is
  'Lifetime reports that earned points (see the award cooldown in
   award_report_points). users.reports_count holds the raw submission count.';
comment on column public.user_points.monthly_reports is
  'Reports that earned points in monthly_period. Reset lazily on the first
   write of a new month.';


-- -----------------------------------------------------------------------------
-- Part 4: the audit log
--
-- Every point that moves leaves a row here. Without it there is no way to
-- answer "why does this account have 1,240 points" before paying a prize on it.
-- station_id is denormalised alongside report_id so the per-station award
-- cooldown below is a single index lookup.
-- -----------------------------------------------------------------------------
create table if not exists public.point_transactions (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  report_id    uuid references public.reports (id) on delete cascade,
  station_id   uuid references public.stations (id) on delete set null,
  points       integer not null,
  reason       public.point_reason not null,
  created_at   timestamptz not null default now()
);

create index if not exists point_transactions_user_idx
  on public.point_transactions (auth_user_id, created_at desc);

-- Supports the per-station award cooldown lookup in the trigger.
create index if not exists point_transactions_user_station_idx
  on public.point_transactions (auth_user_id, station_id, created_at desc);


-- -----------------------------------------------------------------------------
-- Part 5: the award trigger
--
-- AFTER INSERT: enforce_report_rules() (BEFORE INSERT) has already rejected
-- anything too far away, too soon, or unauthenticated, so anything reaching
-- here is a report worth scoring.
--
-- AWARD COOLDOWN vs REPORT COOLDOWN -- deliberately different numbers:
--   * reports are accepted every 30 minutes, because drivers need fresh data
--   * points are awarded at most every 2 hours per station, because paying for
--     volume at one pump is the cheapest way to farm a prize
-- Data freshness and payout integrity are separate concerns; tying them to one
-- number would have to compromise one of them.
-- -----------------------------------------------------------------------------
create or replace function public.award_report_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now_ist      timestamp;
  v_today_ist    date;
  v_hour         integer;
  v_period       text;
  v_multiplier   numeric := 1.00;
  v_prev_award   timestamptz;
  v_prev_report  timestamptz;
  v_is_first     boolean;
  v_base         integer := 5;
  v_first_of_day integer := 0;
  v_peak         integer := 0;
  v_stale        integer := 0;
  v_awarded      integer := 0;
  v_last_date    date;
  v_streak       integer;
begin
  -- Scoring must never cost a driver their report. Any failure below is
  -- swallowed by the handler at the end of this block.

  -- 1. Award cooldown. Silent by design: telling someone which reports stop
  --    earning is telling them how to farm around it.
  select max(created_at) into v_prev_award
    from public.point_transactions
   where auth_user_id = new.auth_user_id
     and station_id   = new.station_id
     and reason       = 'base_report'
     and created_at   > now() - interval '2 hours';

  if v_prev_award is not null then
    return new;
  end if;

  -- 2. Everything date-shaped is IST. The server runs UTC, so a naive
  --    date/hour would put "peak hours" and the daily streak 5.5 hours out.
  v_now_ist   := now() at time zone 'Asia/Kolkata';
  v_today_ist := v_now_ist::date;
  v_hour      := extract(hour from v_now_ist);
  v_period    := to_char(v_now_ist, 'YYYY-MM');

  -- 3. City multiplier, from the station rather than the user.
  select coalesce(cm.multiplier, 1.00)
    into v_multiplier
    from public.stations s
    left join public.city_multipliers cm on cm.city = s.city
   where s.id = new.station_id;

  v_multiplier := coalesce(v_multiplier, 1.00);

  -- 4. Bonuses. first_of_day and stale_station both pay for filling a gap in
  --    the data rather than for volume, which is the behaviour worth buying.
  select not exists (
    select 1
      from public.reports r
     where r.station_id = new.station_id
       and r.id <> new.id
       and (r.created_at at time zone 'Asia/Kolkata')::date = v_today_ist
  ) into v_is_first;

  if v_is_first then
    v_first_of_day := 10;
  end if;

  if v_hour between 6 and 9 or v_hour between 17 and 19 then
    v_peak := 8;
  end if;

  select max(r.created_at) into v_prev_report
    from public.reports r
   where r.station_id = new.station_id
     and r.id <> new.id;

  if v_prev_report is null or v_prev_report < now() - interval '2 hours' then
    v_stale := 12;
  end if;

  -- 5. Log each component separately, each already multiplied, so the rows
  --    always sum to exactly what was awarded. Rounding the total instead
  --    would leave an audit log that does not reconcile with the balance.
  insert into public.point_transactions (auth_user_id, report_id, station_id, points, reason)
  values (new.auth_user_id, new.id, new.station_id, round(v_base * v_multiplier), 'base_report');
  v_awarded := round(v_base * v_multiplier);

  if v_first_of_day > 0 then
    insert into public.point_transactions (auth_user_id, report_id, station_id, points, reason)
    values (new.auth_user_id, new.id, new.station_id, round(v_first_of_day * v_multiplier), 'first_of_day');
    v_awarded := v_awarded + round(v_first_of_day * v_multiplier);
  end if;

  if v_peak > 0 then
    insert into public.point_transactions (auth_user_id, report_id, station_id, points, reason)
    values (new.auth_user_id, new.id, new.station_id, round(v_peak * v_multiplier), 'peak_hours');
    v_awarded := v_awarded + round(v_peak * v_multiplier);
  end if;

  if v_stale > 0 then
    insert into public.point_transactions (auth_user_id, report_id, station_id, points, reason)
    values (new.auth_user_id, new.id, new.station_id, round(v_stale * v_multiplier), 'stale_station');
    v_awarded := v_awarded + round(v_stale * v_multiplier);
  end if;

  -- 6. Streak, on IST calendar days. Reporting twice in one day neither
  --    extends nor breaks it.
  select up.last_report_date, up.current_streak
    into v_last_date, v_streak
    from public.user_points up
   where up.auth_user_id = new.auth_user_id;

  if v_last_date is null then
    v_streak := 1;
  elsif v_last_date = v_today_ist then
    v_streak := greatest(coalesce(v_streak, 1), 1);
  elsif v_last_date = v_today_ist - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  -- 7. Totals. The monthly_period comparison is the lazy reset: the first
  --    write in a new month starts the monthly counters from this report
  --    rather than adding to last month's.
  insert into public.user_points as up (
    auth_user_id, total_points, monthly_points, total_reports, monthly_reports,
    monthly_period, current_streak, longest_streak, last_report_date, updated_at
  )
  values (
    new.auth_user_id, v_awarded, v_awarded, 1, 1,
    v_period, v_streak, v_streak, v_today_ist, now()
  )
  on conflict (auth_user_id) do update set
    total_points     = up.total_points + v_awarded,
    monthly_points   = case when up.monthly_period is distinct from v_period
                            then v_awarded
                            else up.monthly_points + v_awarded end,
    total_reports    = up.total_reports + 1,
    monthly_reports  = case when up.monthly_period is distinct from v_period
                            then 1
                            else up.monthly_reports + 1 end,
    monthly_period   = v_period,
    current_streak   = v_streak,
    longest_streak   = greatest(up.longest_streak, v_streak),
    last_report_date = v_today_ist,
    updated_at       = now();

  return new;

exception
  when others then
    -- A scoring bug must not reject a report. The driver's data is the
    -- product; points are a layer on top of it.
    raise warning 'award_report_points failed for report %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists reports_award_points on public.reports;
create trigger reports_award_points
  after insert on public.reports
  for each row execute function public.award_report_points();


-- -----------------------------------------------------------------------------
-- Part 6: row level security
--
-- Read-your-own only. The leaderboard needs to read OTHER users' totals, but
-- that will be served by a purpose-built view exposing display name, city and
-- rank -- not by opening this table up. Widening access is a cheap policy
-- change later; un-leaking data is not.
--
-- Nothing here is client-writable at all: the trigger owns every write, and
-- it runs as SECURITY DEFINER.
-- -----------------------------------------------------------------------------
alter table public.user_points        enable row level security;
alter table public.point_transactions enable row level security;
alter table public.city_multipliers   enable row level security;

drop policy if exists user_points_select_self on public.user_points;
create policy user_points_select_self
  on public.user_points for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists point_transactions_select_self on public.point_transactions;
create policy point_transactions_select_self
  on public.point_transactions for select
  to authenticated
  using (auth_user_id = auth.uid());

-- Readable so the client could explain scoring if we ever choose to show it.
-- The multiplier is applied server-side either way.
drop policy if exists city_multipliers_select_all on public.city_multipliers;
create policy city_multipliers_select_all
  on public.city_multipliers for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.user_points        from anon, authenticated;
revoke insert, update, delete on public.point_transactions from anon, authenticated;
revoke insert, update, delete on public.city_multipliers   from anon, authenticated;


-- -----------------------------------------------------------------------------
-- Verify (run manually after applying):
--
--   -- multipliers seeded
--   select * from public.city_multipliers;
--
--   -- after submitting one report from the app:
--   select points, reason, created_at from public.point_transactions
--    order by created_at desc limit 10;
--
--   select total_points, monthly_points, monthly_period, current_streak
--     from public.user_points;
--
--   -- the components must reconcile with the balance
--   select sum(points) from public.point_transactions;
-- -----------------------------------------------------------------------------
