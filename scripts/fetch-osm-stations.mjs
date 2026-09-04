#!/usr/bin/env node
/**
 * Fetches candidate CNG stations in Bangalore from OpenStreetMap and writes a
 * CSV for manual review.
 *
 *   node scripts/fetch-osm-stations.mjs
 *
 * Output: data/stations-draft.csv
 *
 * WHY A REVIEW STEP EXISTS
 * OSM coverage of Indian CNG stations is partial and its coordinates are often
 * the road centreline rather than the forecourt. Because the app enforces a
 * 300 m proximity rule before accepting a report, a pin that is 400 m off makes
 * a station permanently unreportable. So this script deliberately produces a
 * DRAFT for a human to correct -- it never writes to the database.
 *
 * The `needs_review` column flags rows that are most likely to be wrong.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Greater Bangalore bounding box: south, west, north, east. */
const BBOX = [12.7342, 77.3791, 13.1739, 77.8826];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Matches the several ways CNG availability is tagged in OSM. `amenity=fuel`
 * alone would return every petrol pump in the city, so each clause requires a
 * CNG-specific tag.
 */
const QUERY = `
[out:json][timeout:90];
(
  node["amenity"="fuel"]["fuel:cng"="yes"](${BBOX.join(",")});
  way["amenity"="fuel"]["fuel:cng"="yes"](${BBOX.join(",")});
  node["amenity"="fuel"]["fuel:CNG"="yes"](${BBOX.join(",")});
  way["amenity"="fuel"]["fuel:CNG"="yes"](${BBOX.join(",")});
  node["amenity"="fuel"]["fuel"="cng"](${BBOX.join(",")});
  way["amenity"="fuel"]["fuel"="cng"](${BBOX.join(",")});
  node["amenity"="compressed_air"]["cng"="yes"](${BBOX.join(",")});
);
out center tags;
`;

/** CSV-escapes one field. */
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Best-effort street address from the scattered addr:* tags. */
function buildAddress(tags) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] ?? tags["addr:neighbourhood"],
  ].filter(Boolean);

  return parts.join(", ");
}

/** Operator, normalised to the handful of names used in India. */
function normaliseOperator(tags) {
  const raw = (tags.operator ?? tags.brand ?? tags.name ?? "").toLowerCase();

  if (raw.includes("indian oil") || raw.includes("indianoil") || raw.includes("iocl")) {
    return "Indian Oil";
  }
  if (raw.includes("bharat") || raw.includes("bpcl")) return "BPCL";
  if (raw.includes("hindustan") || raw.includes("hpcl") || raw.includes("hp ")) {
    return "HP";
  }
  if (raw.includes("gail")) return "GAIL";
  if (raw.includes("shell")) return "Shell";
  if (raw.includes("reliance")) return "Reliance";
  if (raw.includes("nayara") || raw.includes("essar")) return "Nayara";
  return tags.operator ?? tags.brand ?? "";
}

/**
 * POSTs to Overpass, preferring the built-in fetch and falling back to curl.
 *
 * The fallback exists because on a network with a TLS-inspecting proxy (common
 * on corporate Windows machines) Node rejects the intercepted certificate with
 * "unable to get local issuer certificate", while curl succeeds because it uses
 * the Windows certificate store. Disabling Node's verification would also work,
 * but silently accepting any certificate is not a trade worth making for a
 * convenience script.
 */
async function postOverpass(endpoint, body) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.json();
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
      [
        "-sS",
        "--max-time",
        "120",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/x-www-form-urlencoded",
        "--data-binary",
        body,
        endpoint,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    return JSON.parse(stdout);
  }
}

async function queryOverpass() {
  const body = `data=${encodeURIComponent(QUERY)}`;
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      process.stdout.write(`Querying ${endpoint}\n`);
      return await postOverpass(endpoint, body);
    } catch (error) {
      lastError = error;
      process.stdout.write(`  failed: ${error.message}\n`);
    }
  }

  throw new Error(
    `All Overpass endpoints failed. Last error: ${lastError?.message ?? "unknown"}`,
  );
}

function toRow(element) {
  const tags = element.tags ?? {};

  // Nodes carry lat/lon directly; ways carry a computed centre from `out center`.
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (latitude === undefined || longitude === undefined) return null;

  const name = tags.name ?? tags.operator ?? tags.brand ?? "";
  const operator = normaliseOperator(tags);
  const address = buildAddress(tags);

  // Flag the rows a reviewer most needs to look at.
  const problems = [];
  if (!name) problems.push("no-name");
  if (!address) problems.push("no-address");
  if (element.type === "way") problems.push("way-centroid");
  if (!operator) problems.push("no-operator");

  const hours = tags.opening_hours ?? "";
  const is24x7 = hours === "24/7" ? "true" : "false";

  return {
    osm_id: `${element.type}/${element.id}`,
    name,
    operator,
    address,
    area: tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? tags["addr:city"] ?? "",
    latitude: Number(latitude).toFixed(6),
    longitude: Number(longitude).toFixed(6),
    is_24x7: is24x7,
    opening_hours: hours,
    phone: tags.phone ?? tags["contact:phone"] ?? "",
    needs_review: problems.join("|"),
  };
}

async function main() {
  const data = await queryOverpass();
  const elements = data.elements ?? [];

  process.stdout.write(`\nOverpass returned ${elements.length} element(s).\n`);

  const rows = elements.map(toRow).filter(Boolean);

  // Deduplicate: a site tagged as both a node and an enclosing way appears twice.
  const seen = new Set();
  const unique = rows.filter((row) => {
    const key = `${Number(row.latitude).toFixed(4)},${Number(row.longitude).toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const headers = [
    "osm_id",
    "name",
    "operator",
    "address",
    "area",
    "latitude",
    "longitude",
    "is_24x7",
    "opening_hours",
    "phone",
    "needs_review",
  ];

  const csv = [
    headers.join(","),
    ...unique.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
  ].join("\n");

  const outPath = resolve(process.cwd(), "data", "stations-draft.csv");
  await writeFile(outPath, `${csv}\n`, "utf8");

  const flagged = unique.filter((row) => row.needs_review).length;

  process.stdout.write(
    [
      "",
      `Wrote ${unique.length} station(s) to data/stations-draft.csv`,
      `  ${rows.length - unique.length} duplicate(s) removed`,
      `  ${flagged} row(s) flagged in needs_review`,
      "",
      "NEXT: open the CSV and check every row.",
      "  - Verify each latitude/longitude against satellite view. The app rejects",
      "    reports more than 300 m from the pin, so an inaccurate coordinate makes",
      "    a station unreportable.",
      "  - Fill in missing names and operators.",
      "  - Delete anything that is not actually a CNG station.",
      "  - Add stations OSM is missing -- coverage is partial. Leave osm_id blank",
      "    for those and the importer will generate one.",
      "",
      "THEN: node scripts/import-stations.mjs",
      "",
    ].join("\n"),
  );

  if (unique.length === 0) {
    process.stdout.write(
      "WARNING: no stations found. OSM coverage may be sparse, or the tags may\n" +
        "differ. Try the Overpass Turbo UI at https://overpass-turbo.eu to explore.\n\n",
    );
  }
}

main().catch((error) => {
  process.stderr.write(`\nFailed: ${error.message}\n`);
  process.exit(1);
});
