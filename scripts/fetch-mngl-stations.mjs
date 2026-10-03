#!/usr/bin/env node
/**
 * Fetches Maharashtra Natural Gas Limited (MNGL) CNG stations.
 *
 *   node scripts/fetch-mngl-stations.mjs
 *
 * Output: data/stations-mngl.csv
 *
 * WHY THE OPERATOR'S OWN PAGE IS THE BEST SOURCE
 * PNGRB grants each city gas distributor marketing exclusivity over its
 * Geographical Area, so MNGL's own list IS the list for Pune, Pimpri-Chinchwad,
 * Nashik and its other GAs -- there is no second CNG retailer there whose
 * stations we could be missing. It also naturally includes ordinary petrol
 * pumps that additionally dispense CNG, which is most of them: entries like
 * "Vardhman Petrol Depot" are petrol stations with an MNGL CNG dispenser.
 *
 * For comparison, OpenStreetMap carries fewer than 100 CNG stations for the
 * whole of Maharashtra and Karnataka combined. This one page carries ~123.
 *
 * MNGL publishes the page as plain server-rendered HTML with no bot challenge,
 * for the express purpose of helping drivers find a station.
 *
 * COORDINATES
 * The page mixes two notations in the same column, and both must be handled:
 *   - DMS      18°27'27.3"N 73°49'44.2"E   (0.1" ~ 3 m -- plenty accurate)
 *   - decimal  18.50721837343238, 73.80262024617585
 * Accuracy is functional here, not cosmetic: the app refuses a report made more
 * than 300 m from the pin, so a bad coordinate makes a station permanently
 * unreportable. Anything too coarse is flagged rather than silently imported.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_URL = "https://mngl.in/cng/cylinders-filling-stations";

/**
 * Below three decimal places a coordinate is worth no better than ~110 m,
 * which eats a third of the 300 m reporting radius on its own. Tighter than
 * the radius on purpose.
 */
const MIN_SAFE_DECIMALS = 3;

/** Two stations closer together than this are probably one station listed twice. */
const DUPLICATE_METRES = 60;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Fetches a URL, preferring the built-in fetch and falling back to curl.
 *
 * The fallback exists because on a network with a TLS-inspecting proxy (common
 * on corporate Windows machines) Node rejects the intercepted certificate with
 * "unable to get local issuer certificate", while curl succeeds because it uses
 * the Windows certificate store.
 */
async function fetchPage(url) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    const cause = error?.cause;
    const looksLikeTls =
      error.message === "fetch failed" ||
      String(cause?.message ?? "").includes("certificate") ||
      String(cause?.code ?? "").includes("CERT");

    if (!looksLikeTls) throw error;

    process.stdout.write("  fetch blocked (TLS interception?), retrying via curl\n");

    const { stdout } = await execFileAsync(
      "curl",
      ["-sSL", "--max-time", "120", "-A", USER_AGENT, url],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  }
}

/** Turns the HTML entities the page uses back into characters. */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&deg;/g, "°")
    .replace(/&amp;/g, "&");
}

/** Strips tags and collapses whitespace. */
function textOf(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const DECIMAL_RE = /(\d{1,2}\.\d{3,})\s*,\s*(\d{2,3}\.\d{3,})/;
const DMS_RE =
  /(\d{1,2})\s*°\s*(\d{1,2})\s*'\s*([\d.]+)\s*"\s*([NS])[\s,]*(\d{2,3})\s*°\s*(\d{1,2})\s*'\s*([\d.]+)\s*"\s*([EW])/;

/** Decimal places actually present, used to judge precision. */
function decimalsOf(value) {
  const dot = String(value).indexOf(".");
  return dot === -1 ? 0 : String(value).length - dot - 1;
}

/**
 * Pulls a coordinate out of a row, in whichever notation it uses.
 *
 * Returns the effective precision too. A DMS reading to 0.1 of an arcsecond is
 * about 3 m, comfortably better than anything the 300 m rule needs, so DMS is
 * always treated as high precision.
 */
function parseCoords(rowHtml) {
  const decoded = decodeEntities(rowHtml);

  const dms = DMS_RE.exec(decoded);
  if (dms) {
    const [, dLat, mLat, sLat, hemLat, dLon, mLon, sLon, hemLon] = dms;
    const lat =
      (Number(dLat) + Number(mLat) / 60 + Number(sLat) / 3600) * (hemLat === "S" ? -1 : 1);
    const lon =
      (Number(dLon) + Number(mLon) / 60 + Number(sLon) / 3600) * (hemLon === "W" ? -1 : 1);
    return { latitude: lat, longitude: lon, decimals: 6, notation: "dms" };
  }

  const dec = DECIMAL_RE.exec(decoded);
  if (dec) {
    return {
      latitude: Number(dec[1]),
      longitude: Number(dec[2]),
      decimals: Math.min(decimalsOf(dec[1]), decimalsOf(dec[2])),
      notation: "decimal",
    };
  }

  return null;
}

/** Metres between two coordinates (equirectangular -- exact enough at 60 m). */
function metresBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const x = toRad(b.longitude - a.longitude) * Math.cos(toRad((a.latitude + b.latitude) / 2));
  const y = toRad(b.latitude - a.latitude);
  return Math.sqrt(x * x + y * y) * R;
}

/** CSV-escapes one field. */
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  process.stdout.write(`Fetching ${SOURCE_URL}\n`);
  const html = await fetchPage(SOURCE_URL);
  process.stdout.write(`  ${html.length} bytes\n`);

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  process.stdout.write(`  ${rows.length} table row(s)\n`);

  const stations = [];
  let skippedNoCoords = 0;

  for (const rowHtml of rows) {
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      textOf(m[1]),
    );

    // Header and spacer rows have no usable serial number.
    const serial = (cells[0] ?? "").trim();
    if (!/^\d+$/.test(serial)) continue;

    const name = (cells[1] ?? "").trim();
    if (!name) continue;

    const coords = parseCoords(rowHtml);
    if (!coords) {
      skippedNoCoords += 1;
      continue;
    }

    const location = (cells[2] ?? "").trim();
    const area = (cells[3] ?? "").trim();

    const flags = [];
    if (coords.decimals < MIN_SAFE_DECIMALS) {
      flags.push(`low-precision-coords:${coords.decimals}dp`);
    }

    // A station outside MNGL's licensed footprint means the page changed shape
    // and the columns have shifted -- worth a human look rather than a silent
    // import. Generous box around MNGL's Maharashtra GAs.
    if (
      coords.latitude < 15.5 ||
      coords.latitude > 22.2 ||
      coords.longitude < 72.5 ||
      coords.longitude > 81.0
    ) {
      flags.push("outside-expected-area");
    }

    stations.push({
      osm_id: `mngl/${serial}-${slug(name).slice(0, 40)}`,
      name,
      operator: "MNGL",
      address: location,
      area: area || location,
      state: "Maharashtra",
      latitude: coords.latitude.toFixed(6),
      longitude: coords.longitude.toFixed(6),
      is_24x7: "",
      opening_hours: "",
      phone: "",
      needs_review: flags.join("|"),
    });
  }

  // Flag near-coincident pins rather than dropping either: two genuinely
  // adjacent dispensers do exist, and that is a judgement for a reviewer.
  for (let i = 0; i < stations.length; i += 1) {
    for (let j = i + 1; j < stations.length; j += 1) {
      const a = stations[i];
      const b = stations[j];
      const gap = metresBetween(
        { latitude: Number(a.latitude), longitude: Number(a.longitude) },
        { latitude: Number(b.latitude), longitude: Number(b.longitude) },
      );
      if (gap < DUPLICATE_METRES) {
        const note = `possible-duplicate:${Math.round(gap)}m`;
        a.needs_review = [a.needs_review, note].filter(Boolean).join("|");
        b.needs_review = [b.needs_review, note].filter(Boolean).join("|");
      }
    }
  }

  const headers = [
    "osm_id", "name", "operator", "address", "area", "state",
    "latitude", "longitude", "is_24x7", "opening_hours", "phone", "needs_review",
  ];

  const csv = [
    headers.join(","),
    ...stations.map((s) => headers.map((h) => csvCell(s[h])).join(",")),
  ].join("\n");

  const outPath = resolve(process.cwd(), "data", "stations-mngl.csv");
  await writeFile(outPath, `${csv}\n`, "utf8");

  const flagged = stations.filter((s) => s.needs_review);

  process.stdout.write(
    [
      "",
      `Wrote ${stations.length} station(s) to data/stations-mngl.csv`,
      skippedNoCoords ? `  ${skippedNoCoords} row(s) skipped: no coordinate published` : "",
      `  ${flagged.length} row(s) flagged in needs_review`,
      ...flagged.slice(0, 15).map((s) => `    - ${s.name}: ${s.needs_review}`),
      "",
      "Every station here is an MNGL CNG outlet by definition -- the list is",
      "published by MNGL as their own CNG station locator, so no separate CNG",
      "confirmation step is needed the way it is for OpenStreetMap data.",
      "",
      "NEXT: node scripts/review-stations.mjs --file=data/stations-mngl.csv --out=data/stations-mngl-review.html",
      "THEN: node scripts/import-stations.mjs --file data/stations-mngl.csv --city maharashtra",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`\nFailed: ${error.message}\n`);
  process.exit(1);
});
