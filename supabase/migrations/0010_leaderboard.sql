-- =============================================================================
-- CNG Now -- leaderboard (gamification phase B).
--
-- A leaderboard has to read OTHER drivers' totals, which user_points_select_self
-- (0008) deliberately forbids. Rather than widen that policy, this exposes two
-- SECURITY DEFINER functions that return only what a leaderboard needs.
--
-- WHY NOT JUST OPEN THE TABLE: a select policy of `using (true)` would also
-- hand out every row's auth_user_id, streak history and accuracy score to any
-- client that asks. These return a display name, a city, two counters and a
-- flag for "this row is you" -- and notably NOT auth_user_id, which nothing on
-- screen needs and which is the handle to somebody's whole account.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Part 1: display names
--
-- users.display_name has existed since 0001 but nothing ever wrote to it. It
-- becomes publicly visible the moment a leaderboard exists, so it gets a
-- length bound now, while every row is still null and the constraint cannot
-- fail. Two characters stops blank-looking entries; twenty keeps one driver
-- from pushing the rest of the row off screen.
-- -----------------------------------------------------------------------------
alter table public.users
  drop constraint if exists users_display_name_length;

alter table public.users
  add constraint users_display_name_length
  check (
    display_name is null
    or char_length(btrim(display_name)) between 2 and 20
  );


-- -----------------------------------------------------------------------------
-- Part 2: this month's standings
--
-- Output columns are deliberately named so they cannot collide with the
-- columns they are selected from: in a `language sql` function the OUT
-- parameter names are in scope, and a bare `city` or `points` would be
-- ambiguous against the joined tables.
--
-- `rank()` rather than `row_number()`: two drivers on the same points are
-- genuinely tied, and showing one of them as strictly ahead would be a lie
-- that eventually decides a prize.
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
  -- Drivers have no city of their own; use the one they last reported in.
  -- Cheaper and more honest than asking them to pick, and it follows them if
  -- they move.
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
      -- Never show a raw uuid. A short stable handle keeps the board readable
      -- for anyone who has not named themselves yet.
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
  order by up.monthly_points desc
  limit max_results;
$$;


-- -----------------------------------------------------------------------------
-- Part 3: the caller's own standing
--
-- Separate from leaderboard() because the caller is very often outside the top
-- 100, and "you are #247" is the number that actually motivates the next
-- report. Returns no rows at all when the caller has not scored this month --
-- which the UI reads as "not on the board yet" rather than as rank zero.
-- -----------------------------------------------------------------------------
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
  )
  select ranked.place::integer,
         ranked.monthly_points,
         ranked.monthly_reports,
         (select count(*) from ranked)::integer
    from ranked
   where ranked.auth_user_id = auth.uid();
$$;


-- Anonymous callers have no auth.uid(), so `is_me` would be meaningless and
-- my_leaderboard_place() would return nothing. The app always holds an
-- anonymous SESSION, which is `authenticated` -- not the `anon` role.
revoke all on function public.leaderboard(integer) from public, anon;
revoke all on function public.my_leaderboard_place() from public, anon;

grant execute on function public.leaderboard(integer)   to authenticated;
grant execute on function public.my_leaderboard_place() to authenticated;


-- -----------------------------------------------------------------------------
-- Verify (run manually):
--   select * from public.leaderboard(10);
--   select * from public.my_leaderboard_place();
--
-- Both return zero rows until somebody scores points this month. That is the
-- correct answer right now, not a failure.
-- -----------------------------------------------------------------------------
