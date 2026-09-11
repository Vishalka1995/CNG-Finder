#!/usr/bin/env node
/**
 * Fetches HPOIL Gas's official CNG station list and extracts the Kolhapur
 * Geographical Area rows into data/stations-hpoil.csv.
 *
 *   node scripts/fetch-hpoil-stations.mjs
 *
 * WHY THIS SOURCE
 * OpenStreetMap has *zero* CNG-tagged stations in Kolhapur district -- verified
 * live against Overpass: 59 `amenity=fuel` stations exist there, and not one
 * carries any cng tag. That is because in Kolhapur (as across most of India)
 * CNG is dispensed at ordinary petrol pumps rather than standalone CNG sites,
 * and OSM contributors have not tagged the CNG attribute on them. The station
 * names here make that plain: "M/s BALAJI PETROL PUMP", "M/s UMIYA
 * PETROCENTRE", "M/s Chogule Petroleum".
 *
 * HPOIL Gas Ltd (an HPCL + Oil India JV) holds the PNGRB licence for the
 * Kolhapur GA, which means marketing exclusivity -- every CNG retail outlet in
 * the district is an HPOIL supply point. So this one source is structurally
 * complete, not merely convenient.
 *
 * The locator's own JS calls this endpoint with filter params, but they are
 * optional: omitting them returns every station HPOIL operates. No auth, no
 * cookie, no token, no User-Agent requirement.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_URL = "https://hpoilgas.in/cng-locator.php?get_cng_fuel_stations=all";

/** Only this Geographical Area; the feed also carries Ambala-Kurukshetra. */
const TARGET_GA = "Kolhapur GA";

const RAW_DIR = resolve(process.cwd(), "data", "raw");
const HTML_PATH = resolve(RAW_DIR, "hpoil-locator.html");
const OUT_PATH = resolve(process.cwd(), "data", "stations-hpoil.csv");

/**
 * Kolhapur district, generous enough to include the southern talukas
 * (Ajara 16.13, Uttur 16.23) that a city-sized box would silently drop.
 */
const BOUNDS = { south: 16.0, west: 73.8, north: 17.0, east: 74.7 };

/**
 * A coordinate given to only 2 decimal places is accurate to roughly ±1.1 km,
 * which exceeds the app's 300 m reporting radius -- a driver standing at such a
 * station would be told they are too far away to report it. 3 dp (~110 m) is
 * tight enough to work. Anything coarser is flagged for a manual fix rather
 * than silently imported as a station nobody can ever report on.
 */
const MIN_SAFE_DECIMALS = 3;

function decimalsOf(text) {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Strips tags and normalises entities/whitespace in one table cell. */
function cellText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  process.stdout.write(`Fetching ${SOURCE_URL}\n`);
  const { stdout: code } = await execFileAsync("curl", [
    "-sS", "-L", "--max-time", "120", "-o", HTML_PATH, "-w", "%{http_code}", SOURCE_URL,
  ]);
  if (code.trim() !== "200") throw new Error(`Download failed: HTTP ${code}`);

  const raw = await readFile(HTML_PATH, "utf8");

  // The markup contains commented-out <td> elements (OMC/CO, Highway Type).
  // Left in place they shift column indices and silently misalign every field.
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");

  const stations = [];
  const rejected = [];

  for (const rowHtml of html.split(/<tr[^>]*>/i).slice(1)) {
    if (!new RegExp(TARGET_GA, "i").test(rowHtml)) continue;

    const coords = rowHtml.match(/query=(-?[\d.]+),(-?[\d.]+)/);
    if (!coords) continue;

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      cellText(m[1]),
    );

    // Columns: Sr No | Station Name | Detailed Address | GA | District | Map
    const serial = cells[0] ?? "";
    const name = cells[1] ?? "";
    const address = cells[2] ?? "";
    const district = cells[4] ?? "";

    const latText = coords[1];
    const lngText = coords[2];
    const latitude = Number(latText);
    const longitude = Number(lngText);

    if (!name) {
      rejected.push(`Sr ${serial}: no station name`);
      continue;
    }

    if (
      latitude < BOUNDS.south || latitude > BOUNDS.north ||
      longitude < BOUNDS.west || longitude > BOUNDS.east
    ) {
      rejected.push(`${name}: (${latitude}, ${longitude}) outside Kolhapur district`);
      continue;
    }

    // Flag, don't drop: a coarse coordinate still identifies a real station,
    // it just needs a human to pin it precisely before drivers rely on it.
    const worstDecimals = Math.min(decimalsOf(latText), decimalsOf(lngText));
    const flags = [];
    if (worstDecimals < MIN_SAFE_DECIMALS) {
      flags.push(`low-precision-coords:${worstDecimals}dp`);
    }
    if (!address) flags.push("no-address");

    stations.push({
      // Namespaced so these never collide with the gail/ or OSM node|way ids.
      osm_id: `hpoil/kolhapur/${serial || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      operator: "HPOIL",
      address,
      area: district,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      is_24x7: "false",
      opening_hours: "",
      phone: "",
      needs_review: flags.join("|"),
    });
  }

  // Two rows ~30 m apart sharing an operator name are likely one forecourt
  // listed twice. Flag rather than merge -- that is a judgement call for a
  // human, and a wrongly merged pair loses a real station.
  for (let i = 0; i < stations.length; i += 1) {
    for (let j = i + 1; j < stations.length; j += 1) {
      const a = stations[i];
      const b = stations[j];
      const dLat = (Number(a.latitude) - Number(b.latitude)) * 111_320;
      const dLng =
        (Number(a.longitude) - Number(b.longitude)) *
        111_320 * Math.cos((Number(a.latitude) * Math.PI) / 180);
      const metres = Math.hypot(dLat, dLng);
      if (metres < 150) {
        const note = `possible-duplicate:${Math.round(metres)}m`;
        a.needs_review = [a.needs_review, note].filter(Boolean).join("|");
        b.needs_review = [b.needs_review, note].filter(Boolean).join("|");
      }
    }
  }

  const headers = [
    "osm_id", "name", "operator", "address", "area",
    "latitude", "longitude", "is_24x7", "opening_hours", "phone", "needs_review",
  ];

  const csv = [
    headers.join(","),
    ...stations.map((s) => headers.map((h) => csvCell(s[h])).join(",")),
  ].join("\n");

  await writeFile(OUT_PATH, `${csv}\n`, "utf8");

  const flagged = stations.filter((s) => s.needs_review);

  process.stdout.write(
    [
      "",
      `Wrote ${stations.length} Kolhapur station(s) to data/stations-hpoil.csv`,
      `  ${rejected.length} rejected`,
      ...rejected.map((r) => `    - ${r}`),
      `  ${flagged.length} flagged for review:`,
      ...flagged.map((s) => `    - ${s.name}: ${s.needs_review}`),
      "",
      "Source: HPOIL Gas Ltd CNG locator (PNGRB licensee for the Kolhapur GA).",
      "",
      "NEXT: node scripts/import-stations.mjs --file data/stations-hpoil.csv --city Kolhapur",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exit(1);
});
