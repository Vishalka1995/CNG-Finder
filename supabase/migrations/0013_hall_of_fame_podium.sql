-- =============================================================================
-- CNG Now -- Hall of Fame shows the whole podium.
--
-- hall_of_fame() (0012) returned only the winner. Three places are already
-- declared and paid each month, so showing one of them threw away two thirds
-- of the record -- and a podium reads as a competition where a single name
-- reads as a notice.
--
-- Also drops winner_quote from the result. The column stays on the table, so
-- quotes can still be collected when a prize is claimed, but nothing displays
-- them and an API that returns fields no caller uses is just a thing to
-- maintain.
-- =============================================================================

drop function if exists public.hall_of_fame(integer);

create or replace function public.hall_of_fame(max_months integer default 12)
returns table (
  month       text,
  place       integer,
  winner_name text,
  winner_city text,
  points      integer,
  prize       text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with months as (
    select distinct w.month
      from public.monthly_winners w
     where w.place <= 3
     order by w.month desc
     limit max_months
  )
  select w.month,
         w.place,
         coalesce(nullif(btrim(w.display_name), ''), 'A driver'),
         w.city,
         w.points,
         w.prize_description
    from public.monthly_winners w
    join months m on m.month = w.month
   where w.place <= 3
   -- Newest month first, gold to bronze within it: the order the screen
   -- renders in, so it never has to re-sort.
   order by w.month desc, w.place asc;
$$;

revoke all on function public.hall_of_fame(integer) from public, anon;
grant execute on function public.hall_of_fame(integer) to authenticated;
