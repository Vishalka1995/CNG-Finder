#!/usr/bin/env node
/**
 * Prepares a reviewed station CSV for import.
 *
 *   node scripts/clean-stations.mjs --file=data/stations-mh-ka-combined.csv
 *
 * Writes <file> with a .clean.csv suffix. Does two jobs:
 *
 * 1. DROPS anything not confidently CNG. The rule this app works to is that a
 *    petrol or diesel pump which ALSO sells CNG belongs in the list, but a
 *    station with no CNG must never appear -- a driver running low who is sent
 *    to a pump that cannot fill them is the worst failure this app has. So
 *    rows flagged possible-lpg are removed rather than shipped for someone to
 *    notice later.
 *
 * 2. NAMES the rows OpenStreetMap left unnamed, by asking Nominatim what
 *    locality the coordinate falls in. A station with no name is dropped by
 *    the importer, which throws away a perfectly good coordinate; "CNG Station,
 *    Wagholi" is honest about what is known and still useful to a driver.
 *
 * Nominatim is OSM's own geocoder and is free, but its usage policy requires an
 * identifying User-Agent and at most one request per second. Both are honoured
 * below, and only the handful of unnamed rows are ever looked up.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NOMINATIM_USER_AGENT = "CNGNow/1.0 (CNG station data preparation)";
const NOMINATIM_DELAY_MS = 1100;

/** Parses a `--key=value` flag. */
function flag(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Parses CSV, handling quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const QUOTE = String.fromCharCode(34);

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === QUOTE) {
        if (text[i + 1] === QUOTE) {
          cell += QUOTE;
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === QUOTE) inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows[0];
  return {
    headers,
    rows: rows
      .slice(1)
      .filter((r) => r.length >= headers.length)
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
  };
}

/** CSV-escapes one field. */
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Asks Nominatim which locality a coordinate sits in.
 *
 * Uses curl rather than fetch for the same reason every other script here
 * does: a TLS-inspecting corporate proxy makes Node reject the certificate,
 * while curl uses the Windows certificate store and succeeds.
 */
async function reverseGeocode(latitude, longitude) {
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
    `&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;

  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "--max-time", "45", "-A", NOMINATIM_USER_AGENT, url],
      { maxBuffer: 8 * 1024 * 1024 },
    );

    const data = JSON.parse(stdout);
    const address = data.address ?? {};

    // Most specific useful locality first.
    return (
      address.suburb ??
      address.neighbourhood ??
      address.village ??
      address.town ??
      address.city_district ??
      address.city ??
      address.county ??
      null
    );
  } catch {
    return null;
  }
}

async function main() {
  const fileArg = flag("file");
  if (!fileArg) throw new Error("Pass --file=<path to csv>");

  const inPath = resolve(process.cwd(), fileArg);
  const { headers, rows } = parseCsv((await readFile(inPath, "utf8")).trim());

  // --- 1. drop anything not confidently CNG -------------------------------
  const dropped = [];
  const kept = rows.filter((row) => {
    if (/possible-lpg/.test(row.needs_review ?? "")) {
      dropped.push(`${row.name || "(unnamed)"} -- flagged possible-lpg`);
      return false;
    }
    return true;
  });

  // --- 2. name the unnamed ------------------------------------------------
  const unnamed = kept.filter((row) => !(row.name ?? "").trim());
  process.stdout.write(
    `${rows.length} row(s) in, ${dropped.length} dropped as not-confidently-CNG, ` +
      `${unnamed.length} unnamed to look up\n`,
  );

  let named = 0;
  for (const row of unnamed) {
    const locality =
      (row.area ?? "").trim() ||
      (await reverseGeocode(row.latitude, row.longitude)) ||
      "";

    row.name = locality ? `CNG Station, ${locality}` : "CNG Station";
    if (locality && !(row.area ?? "").trim()) row.area = locality;

    // Naming it resolves the flag that dropped it.
    row.needs_review = (row.needs_review ?? "")
      .split("|")
      .filter((f) => f && f !== "no-name")
      .concat("name-generated")
      .join("|");

    named += 1;
    process.stdout.write(`  ${row.latitude}, ${row.longitude} -> ${row.name}\n`);

    await new Promise((done) => setTimeout(done, NOMINATIM_DELAY_MS));
  }

  const outPath = inPath.replace(/\.csv$/i, "") + ".clean.csv";
  const csv = [
    headers.join(","),
    ...kept.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
  ].join("\n");

  await writeFile(outPath, `${csv}\n`, "utf8");

  process.stdout.write(
    [
      "",
      `Wrote ${kept.length} station(s) to ${outPath}`,
      `  ${dropped.length} dropped as not confidently CNG:`,
      ...dropped.map((d) => `    - ${d}`),
      `  ${named} named from their coordinates`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\nFailed: ${error.message}\n`);
  process.exit(1);
});
