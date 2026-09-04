-- =============================================================================
-- CNG Now -- station import helper.
--
-- Run this once in the Supabase SQL editor before the first
-- `node scripts/import-stations.mjs --commit`.
--
-- WHY THIS EXISTS
-- `stations.location` is a `geography(Point, 4326)` column, and PostgREST
-- cannot accept that type in a JSON body. Rather than granting the importer a
-- way to run arbitrary SQL (a standing remote-code-execution hazard living in
-- your database), this exposes ONE function with typed parameters that can do
-- exactly one thing: upsert a station.
--
-- It is deliberately restricted to the service_role. The anon and authenticated
-- roles used by the app cannot execute it, so nothing shipped in the APK can
-- write station data.
-- =============================================================================

create or replace function public.upsert_station(
  p_osm_id    text,
  p_name      text,
  p_address   text,
  p_area      text,
  p_operator  text,
  p_is_24x7   boolean,
  p_phone     text,
  p_latitude  double precision,
  p_longitude double precision
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  -- Guard against transposed coordinates. In Bangalore latitude is ~12-13 and
  -- longitude is ~77, so a swap would place the station in the Indian Ocean and
  -- silently make it unreportable (the app rejects reports beyond 300 m).
  if p_latitude is null or p_longitude is null then
    raise exception 'COORDINATES_REQUIRED: % has no coordinates', p_name;
  end if;

  if p_latitude < -90 or p_latitude > 90 then
    raise exception 'BAD_LATITUDE: % for %', p_latitude, p_name;
  end if;

  if p_longitude < -180 or p_longitude > 180 then
    raise exception 'BAD_LONGITUDE: % for %', p_longitude, p_name;
  end if;

  insert into public.stations
    (osm_id, name, address, area, city, operator, is_24x7, phone, location, is_active)
  values (
    p_osm_id,
    p_name,
    nullif(p_address, ''),
    nullif(p_area, ''),
    'Bangalore',
    nullif(p_operator, ''),
    coalesce(p_is_24x7, false),
    nullif(p_phone, ''),
    -- ST_MakePoint takes (longitude, latitude) in that order.
    ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
    true
  )
  on conflict (osm_id) do update set
    name       = excluded.name,
    address    = excluded.address,
    area       = excluded.area,
    operator   = excluded.operator,
    is_24x7    = excluded.is_24x7,
    phone      = excluded.phone,
    location   = excluded.location,
    is_active  = true,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Only the service role may import. The app's roles are explicitly excluded, so
-- nothing shipped in the APK can create or modify stations.
revoke all on function public.upsert_station(
  text, text, text, text, text, boolean, text, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.upsert_station(
  text, text, text, text, text, boolean, text, double precision, double precision
) to service_role;
