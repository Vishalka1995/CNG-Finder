-- =============================================================================
-- CNG Now -- 10 test stations for Phase 1 map verification.
--
-- These coordinates are APPROXIMATE area centroids, adequate for testing the
-- map, clustering and the radius query. They are NOT accurate enough for real
-- users: the 300m proximity rule makes coordinate accuracy a functional
-- requirement, so Phase 4 replaces these with surveyed/reviewed locations.
--
-- Idempotent via the `osm_id` unique key, so this can be re-run safely.
--
-- REMINDER: ST_MakePoint(longitude, latitude) -- in that order.
-- =============================================================================

insert into public.stations (name, address, area, location, operator, is_24x7, osm_id)
values
  ('Indian Oil CNG - Koramangala', '80 Feet Road, Koramangala 4th Block', 'Koramangala',
   ST_SetSRID(ST_MakePoint(77.6245, 12.9345), 4326)::geography, 'Indian Oil', true, 'seed-001'),
  ('HP CNG - Indiranagar', '100 Feet Road, Indiranagar', 'Indiranagar',
   ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, 'HP', true, 'seed-002'),
  ('BPCL CNG - Whitefield', 'Whitefield Main Road', 'Whitefield',
   ST_SetSRID(ST_MakePoint(77.7500, 12.9698), 4326)::geography, 'BPCL', false, 'seed-003'),
  ('Indian Oil CNG - Electronic City', 'Hosur Road, Electronic City Phase 1', 'Electronic City',
   ST_SetSRID(ST_MakePoint(77.6600, 12.8452), 4326)::geography, 'Indian Oil', true, 'seed-004'),
  ('HP CNG - Jayanagar', '4th Block, Jayanagar', 'Jayanagar',
   ST_SetSRID(ST_MakePoint(77.5833, 12.9250), 4326)::geography, 'HP', false, 'seed-005'),
  ('BPCL CNG - Hebbal', 'Bellary Road, Hebbal', 'Hebbal',
   ST_SetSRID(ST_MakePoint(77.5946, 13.0358), 4326)::geography, 'BPCL', true, 'seed-006'),
  ('Indian Oil CNG - Marathahalli', 'Outer Ring Road, Marathahalli', 'Marathahalli',
   ST_SetSRID(ST_MakePoint(77.6974, 12.9591), 4326)::geography, 'Indian Oil', true, 'seed-007'),
  ('HP CNG - Rajajinagar', 'Dr Rajkumar Road, Rajajinagar', 'Rajajinagar',
   ST_SetSRID(ST_MakePoint(77.5560, 12.9915), 4326)::geography, 'HP', false, 'seed-008'),
  ('BPCL CNG - Banashankari', 'Kanakapura Road, Banashankari', 'Banashankari',
   ST_SetSRID(ST_MakePoint(77.5730, 12.9250), 4326)::geography, 'BPCL', true, 'seed-009'),
  ('Indian Oil CNG - Yeshwanthpur', 'Tumkur Road, Yeshwanthpur', 'Yeshwanthpur',
   ST_SetSRID(ST_MakePoint(77.5540, 13.0280), 4326)::geography, 'Indian Oil', true, 'seed-010')
on conflict (osm_id) do update
  set name     = excluded.name,
      address  = excluded.address,
      area     = excluded.area,
      location = excluded.location,
      operator = excluded.operator,
      is_24x7  = excluded.is_24x7,
      updated_at = now();
