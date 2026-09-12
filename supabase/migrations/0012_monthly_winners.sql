-- =============================================================================
-- CNG Now -- monthly winners (the record, not yet the machinery).
--
-- Creates the table past champions are written to, and a read path for the
-- Hall of Fame screen. It does NOT create the monthly reset job, winner
-- selection, or anything that pays out -- that is phase C, and it should not
-- run until there are real drivers competing.
--
-- Worth landing early anyway: the shape of this record is what the reset job
-- will have to write, and deciding it now is free. Deciding it later, with
-- a screen already reading the old shape, is not.
--
-- PRIVACY -- the reason there is no plain select policy:
-- this table holds a winner's UPI id. A `using (true)` policy would publish
-- every past winner's payment handle to anyone with the app installed. The
-- Hall of Fame instead reads through hall_of_fame(), which returns the name,
-- city, month and points -- and nothing that could be used to impersonate
-- someone or take their money.
-- =============================================================================

create table if not exists public.monthly_winners (
  id                uuid primary key default gen_random_uuid(),
  -- 'YYYY-MM' in IST, matching user_points.monthly_period.
  month             text not null,
  place             integer not null check (place > 0),
  auth_user_id      uuid references auth.users (id) on delete set null,
  -- Copied at declaration time rather than joined later: a winner may change
  -- their display name afterwards, and the Hall of Fame should keep showing
  -- who won under the name they won with.
  display_name      text,
  city              text,
  points            integer not null default 0,
  reports           integer not null default 0,
  prize_description text,
  prize_amount_inr  integer,
  prize_paid        boolean not null default false,
  upi_id            text,
  winner_quote      text,
  declared_at       timestamptz not null default now(),
  claimed_at        timestamptz,
  unique (month, place)
);

create index if not exists monthly_winners_month_idx
  on public.monthly_winners (month desc, place);


-- -----------------------------------------------------------------------------
-- The public record. Only columns that are safe to show every driver.
-- -----------------------------------------------------------------------------
create or replace function public.hall_of_fame(max_results integer default 24)
returns table (
  month        text,
  place        integer,
  winner_name  text,
  winner_city  text,
  points       integer,
  prize        text,
  quote        text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select w.month,
         w.place,
         coalesce(nullif(btrim(w.display_name), ''), 'A driver'),
         w.city,
         w.points,
         w.prize_description,
         w.winner_quote
    from public.monthly_winners w
   where w.place = 1
   order by w.month desc
   limit max_results;
$$;


-- -----------------------------------------------------------------------------
-- No select policy at all: nothing reads this table directly from the client.
-- Winners are declared and paid with the service role.
-- -----------------------------------------------------------------------------
alter table public.monthly_winners enable row level security;

revoke all on table public.monthly_winners from anon, authenticated;

revoke all on function public.hall_of_fame(integer) from public, anon;
grant execute on function public.hall_of_fame(integer) to authenticated;


-- -----------------------------------------------------------------------------
-- Verify (run manually):
--   select * from public.hall_of_fame();
-- Returns zero rows until a month is actually won. That is correct.
-- -----------------------------------------------------------------------------
