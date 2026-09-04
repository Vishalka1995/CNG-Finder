# CNG Now — Phase 1 setup

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

## What is deliberately not built yet

Phase 1 covers scaffold, schema and the map. Still to come:

- **Phase 2** — station detail sheet, the report flow, optimistic marker updates
- **Phase 3** — list view, favorites, search, settings, offline cache
- **Phase 4** — real Bangalore station data (OSM pull → your review → import)
- **Phase 5** — push notifications, analytics, release build

The List and Favorites tabs are intentional placeholders.

⚠️ The 10 seeded stations use **approximate** coordinates — fine for testing the
map, not accurate enough for real reporting, since the 300m proximity rule makes
coordinate accuracy functional. Phase 4 replaces them.
