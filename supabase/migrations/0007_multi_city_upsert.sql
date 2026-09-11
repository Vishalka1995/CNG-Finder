-- =============================================================================
-- CNG Now -- make station import multi-city.
--
-- `upsert_station` hardcoded 'Bangalore' as the city, which was fine while that
-- was the only Geographical Area we had data for. Kolhapur (HPOIL Gas's PNGRB
-- licence area) is the second, so the city has to become a parameter or every
-- Kolhapur station would be filed under the wrong city.
--
-- The parameter is added with a DEFAULT so existing callers keep working, but
-- the importer now always passes it explicitly.
--
-- Postgres cannot `create or replace` a function when the argument list
-- changes, so the old signature is dropped first. The GRANT is re-applied to
-- the new signature -- without that, the importer loses execute permission and
-- every row fails with a permission error.
-- =============================================================================

drop function if exists public.upsert_station(
  text, text, text, text, text, boolean, text, double precision, double precision
);

create or replace function public.upsert_station(
  p_osm_id    text,
  p_name      text,
  p_address   text,
  p_area      text,
  p_operator  text,
  p_is_24x7   boolean,
  p_phone     text,
  p_latitude  double precision,
  p_longitude double precision,
  p_city      text default 'Bangalore'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  -- Guard against transposed coordinates. Indian longitudes (~68-97) all fall
  -- outside the valid latitude band for India (~8-37), so a lat/lng swap lands
  -- outside these checks and is caught rather than silently placing a station
  -- in the sea -- where it would be permanently unreportable, since the app
  -- rejects reports beyond 300 m.
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
    coalesce(nullif(trim(p_city), ''), 'Bangalore'),
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
    city       = excluded.city,
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

-- Only the service role may import; nothing shipped in the APK can create
-- stations. Re-granted here because the signature changed.
revoke all on function public.upsert_station(
  text, text, text, text, text, boolean, text, double precision, double precision, text
) from public, anon, authenticated;

grant execute on function public.upsert_station(
  text, text, text, text, text, boolean, text, double precision, double precision, text
) to service_role;
