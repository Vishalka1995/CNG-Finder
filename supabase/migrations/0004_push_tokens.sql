-- =============================================================================
-- CNG Now -- push notification groundwork.
--
-- Adds a place to store each device's push token and its own preference for
-- whether it wants notifications at all. Nothing here sends a notification --
-- that requires FCM/APNs credentials, an expo-notifications-enabled dev build,
-- and a Supabase Edge Function to actually push, none of which exist yet
-- (tracked as the rest of Phase 5). Running this migration now means the
-- column already exists once that pipeline is built, instead of needing its
-- own migration and a coordinated app-update at that point.
--
-- No new RLS policy is needed: `users_update_self` (from 0001_init.sql)
-- already lets a device update its own row, and these are ordinary columns on
-- the same table.
-- =============================================================================

alter table public.users
  add column if not exists push_token text,
  add column if not exists notifications_enabled boolean not null default true;

comment on column public.users.push_token is
  'Expo push token (ExponentPushToken[...]). Null until push notifications are
   implemented and the device has registered one.';

comment on column public.users.notifications_enabled is
  'Device-level opt-in, mirrored from the Settings toggle. Checked before
   sending any push once the sending pipeline exists, so a stale token for an
   opted-out device is never used.';
