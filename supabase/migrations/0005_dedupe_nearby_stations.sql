-- =============================================================================
-- CNG Now -- deactivate OSM stations superseded by the GAIL import.
--
-- Run AFTER importing data/stations-gail.csv.
--
-- WHY
-- The OSM-sourced rows and the GAIL-sourced rows describe some of the same
-- physical stations, but under different ids (`node/...`/`way/...` vs
-- `gail/...`), so the importer's osm_id-based upsert cannot dedupe them.
-- Seven pairs sit within 150m of each other -- two of them within 10m -- which
-- would show as duplicate pins on the map and split reports across two records
-- for the same forecourt.
--
-- The GAIL rows win: they carry the operator's own station name and a real
-- street address, where the OSM rows are often just "GAIL" or "Indian Oil".
--
-- Deactivates rather than deletes: `is_active = false` hides them from the app
-- (every read path filters on it) while preserving any reports already
-- attached, since `reports.station_id` references them.
-- =============================================================================

with gail as (
  select id, location
    from public.stations
   where osm_id like 'gail/%'
     and is_active
),
superseded as (
  select distinct osm.id
    from public.stations osm
    join gail on ST_DWithin(osm.location, gail.location, 150)
   where osm.is_active
     and (osm.osm_id like 'node/%' or osm.osm_id like 'way/%')
)
update public.stations
   set is_active  = false,
       updated_at = now()
 where id in (select id from superseded);

-- Expected: 7 rows updated. Verify what remains:
--   select count(*) from public.stations where is_active;
