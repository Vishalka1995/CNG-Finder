-- =============================================================================
-- CNG Now -- badges (gamification phase B).
--
-- Milestones a driver keeps, as opposed to points, which reset every month.
-- That is the whole reason both exist: the monthly reset is what makes the
-- competition winnable by someone who joined in week three, and badges are
-- what stops that reset feeling like losing everything.
-- =============================================================================

create table if not exists public.badges (
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  badge_id     text not null,
  earned_at    timestamptz not null default now(),
  primary key (auth_user_id, badge_id)
);


-- -----------------------------------------------------------------------------
-- Awarding
--
-- Written as a single declarative INSERT ... ON CONFLICT DO NOTHING over a
-- VALUES list of (badge, condition) pairs. Re-running it can only ever add
-- newly-qualified badges, never duplicate or revoke one, so it is safe to call
-- after every scored report and needs no "have they got this already" checks.
--
-- Four badges from the catalogue are deliberately not awarded here:
-- sharp_eye needs the accuracy job, and legend/runner_up/top_ten need monthly
-- winners. Both arrive in a later phase. They render as locked until then,
-- which is honest -- they are real, they are just not winnable yet.
-- -----------------------------------------------------------------------------
create or replace function public.award_badges(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_total    integer;
  v_streak   integer;
  v_stations integer;
  v_early    integer;
begin
  select up.total_reports, up.current_streak
    into v_total, v_streak
    from public.user_points up
   where up.auth_user_id = p_user;

  if v_total is null then
    return;
  end if;

  select count(distinct r.station_id)
    into v_stations
    from public.reports r
   where r.auth_user_id = p_user;

  -- "Before 8am" is a local-clock idea, so it has to be asked in IST.
  select count(*)
    into v_early
    from public.reports r
   where r.auth_user_id = p_user
     and extract(hour from (r.created_at at time zone 'Asia/Kolkata')) < 8;

  insert into public.badges (auth_user_id, badge_id)
  select p_user, candidate.badge_id
    from (values
      ('first_report', v_total    >= 1),
      ('century',      v_total    >= 100),
      ('five_hundred', v_total    >= 500),
      ('streak_7',     v_streak   >= 7),
      ('streak_30',    v_streak   >= 30),
      ('city_scout',   v_stations >= 10),
      ('explorer',     v_stations >= 25),
      ('early_bird',   v_early    >= 10)
    ) as candidate(badge_id, earned)
   where candidate.earned
  on conflict do nothing;
end;
$$;


-- -----------------------------------------------------------------------------
-- Its own trigger rather than a line appended to award_report_points().
--
-- LOAD-BEARING NAME: PostgreSQL fires same-event triggers in alphabetical
-- order, so `reports_award_points` runs before `reports_badges`. Badges read
-- the totals that the first trigger writes, so that order is a dependency, not
-- a coincidence. Renaming this to anything sorting before "reports_award"
-- would silently award badges against last report's totals.
--
-- The alternative was CREATE OR REPLACE on award_report_points() with one
-- extra line, which means copying its whole body into this migration and
-- leaving two versions of the scoring rules in the tree to drift apart.
-- -----------------------------------------------------------------------------
create or replace function public.trigger_award_badges()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.award_badges(new.auth_user_id);
  return new;
exception
  when others then
    -- Same rule as scoring: a badge bug must never cost a driver their report.
    raise warning 'award_badges failed for report %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists reports_badges on public.reports;
create trigger reports_badges
  after insert on public.reports
  for each row execute function public.trigger_award_badges();


-- -----------------------------------------------------------------------------
-- Row level security: read your own, write none. The trigger owns every write.
-- -----------------------------------------------------------------------------
alter table public.badges enable row level security;

drop policy if exists badges_select_self on public.badges;
create policy badges_select_self
  on public.badges for select
  to authenticated
  using (auth_user_id = auth.uid());

revoke insert, update, delete on public.badges from anon, authenticated;


-- -----------------------------------------------------------------------------
-- Verify (run manually):
--   select badge_id, earned_at from public.badges order by earned_at;
--
-- Empty until a report is scored. After the first one, 'first_report'.
-- -----------------------------------------------------------------------------
