# CNG Now — setup

The code is scaffolded and verified. These are the steps that need your
accounts, in order. Budget about 45 minutes, most of it waiting on the build.

---

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Choose region
   **Singapore (ap-southeast-1)** — lowest latency to Bangalore.
2. **Authentication → Providers → Anonymous → enable.**
   The entire anti-spam model depends on this. Without it, every report insert
   fails with `AUTH_REQUIRED` by design.
3. **SQL Editor → New query**, paste and run
   [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql).
   It should complete with no errors.
4. Run [supabase/migrations/0002_seed_test_stations.sql](supabase/migrations/0002_seed_test_stations.sql)
   to load 10 test stations.
5. **Settings → API**, copy the **Project URL** and the **anon/public** key.
   Never copy the `service_role` key into this app.

## 2. MapTiler

1. Sign up at [maptiler.com](https://www.maptiler.com), copy your API key.
2. Restrict the key to the Android package `com.flatworld.cngnow`.
3. Set a **usage alert at 60%**. The free tier allows 5,000 *map sessions* per
   month and **hard-suspends** your maps at the cap rather than degrading — the
   session count, not the request count, is the binding limit.

## 3. Local env

```powershell
Copy-Item .env.example .env
```

Fill in all three values:

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
EXPO_PUBLIC_MAPTILER_KEY=xxxxxxxx
```

`.env` is gitignored. These values are inlined into the bundle and are public in
the shipped APK — that is expected and safe here (RLS is the real boundary), but
it is exactly why the `service_role` key must never appear.

## 4. Regenerate database types (optional but recommended)

`types/database.ts` is hand-written to match the migration. Once the project
exists you can generate it instead:

```powershell
npx supabase login
npx supabase gen types typescript --project-id <your-ref> | Out-File -Encoding utf8 types/database.ts
```

Use `Out-File -Encoding utf8` — PowerShell's `>` writes UTF-16, which TypeScript
rejects.

**If you regenerate, keep two things in mind:** the generator emits `type`
aliases (not `interface`) for row types, which is required — interfaces have no
implicit index signature and silently collapse the supabase-js schema to
`never`. And the generated file will not include the `Views: {}` /
`CompositeTypes: {}` comments; that is fine.

## 5. EAS dev build

```powershell
npx eas login
npx eas init          # writes extra.eas.projectId into app.json -- commit that change
npm run build:dev     # 15-20 minutes in the cloud
```

Install the resulting APK on your phone (EAS gives you a QR code / link), then:

```powershell
npm start
```

The phone connects to your local Metro over Wi-Fi. From here, all JS changes are
instant — no rebuild.

> **Expo Go will not work.** MapLibre requires a custom dev client. `npm start`
> defaults to `--dev-client` for this reason.

### Build budget

The free tier is **15 Android builds/month**. A new build is only needed when
native config changes:

| Free & instant (Metro reload) | Needs a new build |
|---|---|
| Any `.ts` / `.tsx` change | New native module |
| NativeWind classes, `tailwind.config.js` | `plugins`, `permissions`, `package` in app.json |
| Pure-JS deps | `newArchEnabled`, `expo-build-properties` |
| `.env` values (restart Metro) | Expo SDK upgrade |

Batch native changes rather than building per change.

---

## Checkpoint 1 — verify on a physical Android device

Already verified locally: `npm run typecheck` clean, `npm run lint` clean, and
the Android bundle builds with the theme, fonts and MapLibre all compiled in.

Remaining checks need the device and your Supabase project:

1. App launches from the dev-client APK and connects to Metro — no red screen.
2. **Onboarding**: 3 screens; the green `#00A86B` renders; Inter is visibly not
   the system font; the permission dialog appears on screen 3; after completing
   it, onboarding never shows again on relaunch.
3. **Device identity**: open Settings tab, note the Device ID and session id.
   Force-quit, relaunch, reopen Settings — **the Device ID must be identical**
   and the session id non-empty. Then confirm `public.users` has exactly one row
   with a non-null `auth_user_id`.
4. **Map**: the MapTiler basemap draws centred on Bangalore. A blank grey grid
   means a bad or missing key.
5. **Markers**: all 10 seed stations appear, all grey (`unknown`) since there are
   no reports yet.
6. **Clustering**: zoom out → markers collapse into numbered bubbles; zoom in →
   they separate.
7. **Database**: run [supabase/verify.sql](supabase/verify.sql) in the SQL
   editor. Each block states its own pass condition. Sections 5 (anti-spam) and
   6 (RLS) are the ones worth not skipping — 5 proves the rate limit and the
   300m proximity rule actually fire, 6 proves the anon key can read stations
   but cannot write them.

Note that section 5 needs at least one `auth.users` row, so launch the app once
before running it.

---

## Build status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, schema, onboarding, map component | Built |
| 2 | Station detail, report flow, optimistic updates | Built |
| 3 | List, favorites, search, settings, My Reports | Built |
| 4 | OSM fetch + import scripts | Built (see below) |
| 5 | Push notifications, analytics, release build | Not started |

**Everything above has been verified only by typecheck, lint, and a successful
bundle.** Nothing has yet run against a live Supabase project or rendered a real
map — the app currently serves built-in demo stations. The Checkpoint below is
what turns "compiles" into "works".

⚠️ The 10 stations in `0002_seed_test_stations.sql` use **approximate**
coordinates — fine for testing the map, not accurate enough for real reporting,
since the 300 m proximity rule makes coordinate accuracy functional. The Phase 4
import replaces them.

---

## Importing real Bangalore stations (Phase 4)

Two scripts turn OpenStreetMap data into rows in your `stations` table. Run
them after the Supabase steps above.

### 1. Fetch candidates from OpenStreetMap

```powershell
npm run stations:fetch
```

Queries the Overpass API for CNG stations in the Greater Bangalore bounding box
and writes `data/stations-draft.csv`.

**A real run returned 21 stations, every one of them flagged for review** — 19
were "way centroids" (the centre of a building outline rather than the actual
forecourt), none had street addresses, and at least one was an Auto **LPG**
station, not CNG. That is normal for OSM coverage in India, and it is exactly
why the next step is not optional.

### 2. Review the CSV — the important step

Open `data/stations-draft.csv` in Excel and check every row:

- **Verify each latitude/longitude against satellite view.** This matters more
  than anything else on the list: the app refuses reports made more than 300 m
  from a station's pin, so a misplaced pin makes that station permanently
  unreportable. A way-centroid is often 100–300 m off.
- **Delete anything that isn't CNG** (Auto LPG stations show up in the results).
- **Fill in missing names, operators and addresses.**
- **Add stations OSM is missing** — coverage is partial. Leave `osm_id` blank on
  new rows; the importer generates a stable id from the name.
- **Clear the `needs_review` column** on rows you've checked.

### 3. Create the import helper (once)

In the Supabase SQL editor, run
[supabase/migrations/0003_import_helper.sql](supabase/migrations/0003_import_helper.sql).

It adds a single `upsert_station` function with typed parameters, granted only
to the service role. A geography column can't be written through PostgREST's
JSON API, and a generic "run this SQL" function would be a permanent hazard
sitting in your database — this is the narrow alternative.

### 4. Credentials for the importer

```powershell
Copy-Item .env.scripts.example .env.scripts
```

Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Settings →
API).

⚠️ The **service_role key bypasses Row Level Security entirely**. It belongs
only in `.env.scripts`, which is git-ignored. Never put it in `.env`, and never
let it ship inside the app.

### 5. Import

```powershell
npm run stations:import    # dry run - validates and shows a preview
npm run stations:commit    # actually writes to Supabase
```

The dry run is the default, so an accidental run cannot write anything. It
rejects rows with missing names, non-numeric coordinates, coordinates outside
Bangalore, and — importantly — latitude/longitude that look transposed, which is
the single most common way to corrupt geographic data.

Re-running is safe: rows are upserted on `osm_id`, so a second import updates
rather than duplicates.
