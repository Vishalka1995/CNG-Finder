#!/usr/bin/env node
/**
 * Imports the reviewed station CSV into Supabase.
 *
 *   node scripts/import-stations.mjs                      # dry run (default)
 *   node scripts/import-stations.mjs --commit             # actually write
 *   node scripts/import-stations.mjs --file data/x.csv    # a different file
 *
 * Reads credentials from .env.scripts (git-ignored):
 *
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * The SERVICE ROLE key is required because RLS deliberately forbids the app
 * from writing to `stations`. That key bypasses RLS entirely, so it must never
 * be placed in .env or shipped in the app -- only ever here, locally.
 *
 * Idempotent: rows are upserted on `osm_id`, so re-running updates rather than
 * duplicates. Rows without an osm_id get a stable `manual/<slug>` id derived
 * from the name, so hand-added stations also survive a re-run.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DRY_RUN = !process.argv.includes("--commit");
const fileArgIndex = process.argv.indexOf("--file");
const CSV_PATH =
  fileArgIndex !== -1 && process.argv[fileArgIndex + 1]
    ? process.argv[fileArgIndex + 1]
    : "data/stations-draft.csv";

/**
 * Greater Bengaluru bounding box, used to catch transposed or mistyped
 * coordinates. Deliberately wider than the city proper: GAIL's licensed
 * Geographical Area reaches Doddaballapur and Nandi Hills in the north
 * (~13.31 N) and past Hoskote in the east (~77.91 E), and those are real
 * operational stations a driver could legitimately be at.
 */
const BOUNDS = { south: 12.6, west: 77.2, north: 13.4, east: 78.0 };

/** Minimal .env parser -- avoids a dependency for four lines of work. */
async function loadEnv() {
  const path = resolve(process.cwd(), ".env.scripts");

  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      [
        "Missing .env.scripts",
        "",
        "Create it in the project root with:",
        "  SUPABASE_URL=https://xxxx.supabase.co",
        "  SUPABASE_SERVICE_ROLE_KEY=eyJ...",
        "",
        "Find both under Supabase Dashboard > Settings > API.",
        "This file is git-ignored. Never put the service_role key in .env.",
      ].join("\n"),
    );
  }

  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/** Parses CSV, handling quoted fields and embedded commas/newlines. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];

  return body.map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key.trim()] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

/** Stable id for a hand-added station, so re-imports update rather than duplicate. */
function manualId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `manual/${slug}`;
}

/**
 * Validates one row. Returns {station} or {error}.
 *
 * Coordinate checks are strict on purpose: the app rejects reports more than
 * 300 m from a station's pin, so a bad coordinate silently makes that station
 * impossible to report on. Better to refuse the import than ship a dead pin.
 */
function validateRow(row, index) {
  const line = index + 2; // +1 for the header, +1 for 1-based numbering
  const name = (row.name ?? "").trim();

  if (!name) return { error: `line ${line}: missing name` };

  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: `line ${line} (${name}): latitude/longitude not numeric` };
  }

  // A classic bug: lat and lng swapped. In Bangalore longitude is ~77 and
  // latitude is ~12, so a latitude above 20 is almost certainly transposed.
  if (latitude > 20 && longitude < 20) {
    return {
      error: `line ${line} (${name}): latitude/longitude look swapped (${latitude}, ${longitude})`,
    };
  }

  if (
    latitude < BOUNDS.south ||
    latitude > BOUNDS.north ||
    longitude < BOUNDS.west ||
    longitude > BOUNDS.east
  ) {
    return {
      error: `line ${line} (${name}): (${latitude}, ${longitude}) is outside Bangalore`,
    };
  }

  const osmId = (row.osm_id ?? "").trim() || manualId(name);

  return {
    station: {
      osm_id: osmId,
      name,
      address: (row.address ?? "").trim() || null,
      area: (row.area ?? "").trim() || null,
      city: "Bangalore",
      operator: (row.operator ?? "").trim() || null,
      is_24x7: String(row.is_24x7 ?? "").toLowerCase() === "true",
      phone: (row.phone ?? "").trim() || null,
      latitude,
      longitude,
      is_active: true,
    },
  };
}

/**
 * Calls the `upsert_station` RPC for one station.
 *
 * curl rather than fetch because Node's fetch fails behind a TLS-inspecting
 * corporate proxy ("unable to get local issuer certificate") while curl uses
 * the OS certificate store. See scripts/fetch-osm-stations.mjs for the same
 * fallback and a fuller explanation.
 *
 * The RPC takes typed parameters rather than SQL text -- a function that could
 * execute arbitrary SQL would be a standing hazard living in the database.
 */
async function upsertStation(env, station) {
  const payload = {
    p_osm_id: station.osm_id,
    p_name: station.name,
    p_address: station.address,
    p_area: station.area,
    p_operator: station.operator,
    p_is_24x7: station.is_24x7,
    p_phone: station.phone,
    p_latitude: station.latitude,
    p_longitude: station.longitude,
  };

  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sS",
      "--max-time",
      "60",
      "-X",
      "POST",
      `${env.SUPABASE_URL}/rest/v1/rpc/upsert_station`,
      "-H",
      `apikey: ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "-H",
      `Authorization: Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      JSON.stringify(payload),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  const text = stdout.trim();

  // Success returns a bare quoted uuid. PostgREST reports errors as an object
  // carrying a `message` field.
  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 200));
    }
    throw new Error(parsed.message ?? parsed.hint ?? text.slice(0, 200));
  }

  return text.replace(/"/g, "");
}

async function main() {
  const csvPath = resolve(process.cwd(), CSV_PATH);

  let csvText;
  try {
    csvText = await readFile(csvPath, "utf8");
  } catch {
    throw new Error(
      `Cannot read ${CSV_PATH}. Run: node scripts/fetch-osm-stations.mjs`,
    );
  }

  const rows = parseCSV(csvText);
  if (rows.length === 0) throw new Error(`${CSV_PATH} has no data rows.`);

  const stations = [];
  const errors = [];

  rows.forEach((row, index) => {
    const result = validateRow(row, index);
    if (result.error) errors.push(result.error);
    else stations.push(result.station);
  });

  // Duplicate osm_ids would make the upsert non-deterministic.
  const byId = new Map();
  const duplicates = [];
  for (const station of stations) {
    if (byId.has(station.osm_id)) duplicates.push(station.osm_id);
    else byId.set(station.osm_id, station);
  }

  process.stdout.write(
    [
      "",
      `Read ${rows.length} row(s) from ${CSV_PATH}`,
      `  valid      : ${stations.length}`,
      `  rejected   : ${errors.length}`,
      `  duplicates : ${duplicates.length}`,
      "",
    ].join("\n"),
  );

  if (errors.length > 0) {
    process.stdout.write("Rejected rows:\n");
    for (const error of errors) process.stdout.write(`  - ${error}\n`);
    process.stdout.write("\n");
  }

  if (duplicates.length > 0) {
    process.stdout.write(`Duplicate osm_id values: ${duplicates.join(", ")}\n\n`);
  }

  const toImport = [...byId.values()];

  const stillFlagged = rows.filter((row) => (row.needs_review ?? "").trim()).length;
  if (stillFlagged > 0) {
    process.stdout.write(
      `NOTE: ${stillFlagged} row(s) still carry a needs_review flag.\n` +
        "      Clear that column once you have checked the coordinates.\n\n",
    );
  }

  if (DRY_RUN) {
    process.stdout.write(
      [
        "DRY RUN -- nothing was written.",
        "",
        "Preview of the first 5 stations:",
        ...toImport
          .slice(0, 5)
          .map(
            (s) =>
              `  ${s.name} (${s.operator ?? "unknown operator"}) @ ${s.latitude}, ${s.longitude}`,
          ),
        "",
        "Re-run with --commit to write to Supabase.",
        "",
      ].join("\n"),
    );
    return;
  }

  const env = await loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      ".env.scripts must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  process.stdout.write(`Importing ${toImport.length} station(s)…\n`);

  let ok = 0;
  const failures = [];

  for (const station of toImport) {
    try {
      await upsertStation(env, station);
      ok += 1;
    } catch (error) {
      failures.push(`${station.name}: ${error.message}`);
    }
  }

  process.stdout.write(`\nImported ${ok}/${toImport.length}\n`);

  if (failures.length > 0) {
    process.stdout.write("\nFailures:\n");
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
    process.stdout.write(
      "\nIf every row failed, the exec_import_sql helper is probably missing.\n" +
        "Run supabase/migrations/0003_import_helper.sql in the SQL editor first.\n",
    );
  }

  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exit(1);
});
