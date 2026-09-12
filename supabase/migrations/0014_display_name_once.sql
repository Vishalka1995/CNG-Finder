-- =============================================================================
-- CNG Now -- a display name can be set once.
--
-- Enforced here rather than by hiding the edit button, for the same reason the
-- report rules live in the database: the client is not a security boundary.
-- users_update_self lets any signed-in device update its own row, so a name
-- lock that exists only in the app is a lock anyone can pick.
--
-- WHY LOCK IT AT ALL: the name is attached to a public standing and, from
-- phase C, to a prize. Freely editable names let somebody build a reputation
-- under one name and then take another's, or swap names between the
-- leaderboard closing and a payout being made.
--
-- Only the transition from "set" to "different" is refused. Updates that leave
-- display_name untouched -- last_seen_at and reports_count from
-- enforce_report_rules(), push_token, notification preferences -- pass
-- through, because `is distinct from` is false for them.
-- =============================================================================

create or replace function public.enforce_display_name_once()
returns trigger
language plpgsql
as $$
begin
  if coalesce(btrim(old.display_name), '') <> ''
     and new.display_name is distinct from old.display_name then
    raise exception 'DISPLAY_NAME_LOCKED: display name can only be set once'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists users_display_name_once on public.users;
create trigger users_display_name_once
  before update on public.users
  for each row execute function public.enforce_display_name_once();


-- -----------------------------------------------------------------------------
-- Verify (run manually, as a user who already has a name):
--   update public.users set display_name = 'Something Else'
--    where auth_user_id = auth.uid();
--   -- expect: DISPLAY_NAME_LOCKED
-- -----------------------------------------------------------------------------
