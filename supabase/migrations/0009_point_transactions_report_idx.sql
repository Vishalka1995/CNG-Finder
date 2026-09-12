-- =============================================================================
-- CNG Now -- index point_transactions by report.
--
-- The app asks "what did this report just earn?" immediately after inserting,
-- to put the number in the confirmation toast. That lookup is by report_id,
-- which none of the indexes from 0008 cover -- those are keyed on
-- auth_user_id for the profile and cooldown queries. Without this it is a
-- sequential scan on a table that grows by several rows per report forever.
--
-- Cheap to add now, annoying to notice later: the scan stays fast enough to
-- go unnoticed until the table is large, by which point it is on the hot path
-- of every single report submission.
-- =============================================================================

create index if not exists point_transactions_report_idx
  on public.point_transactions (report_id);
