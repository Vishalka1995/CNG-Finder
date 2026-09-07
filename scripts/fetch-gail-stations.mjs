#!/usr/bin/env node
/**
 * Fetches GAIL Gas's official operational-CNG-station list and extracts the
 * Bengaluru rows into data/stations-gail.csv.
 *
 *   node scripts/fetch-gail-stations.mjs
 *
 * WHY THIS SOURCE
 * OpenStreetMap only had 21 Bangalore CNG stations. GAIL Gas (the City Gas
 * Distribution licensee for the Bengaluru Geographical Area) publishes a PDF
 * of operational stations that includes real WGS84 coordinates, and it covers
 * IOCL / HPCL / BPCL / GAIL-branded sites in one document -- so it replaces
 * scraping four separate operator locators.
 *
 * WHAT IS DELIBERATELY NOT USED
 * GAIL also publishes a "Planned CNG Stations" PDF with ~78 more Bengaluru
 * rows. Those are excluded: the file carries no field saying which planned
 * sites were actually built, and sending a driver to an empty lot is worse
 * than omitting a station.
 *
 * PARSING APPROACH
 * `pdftotext -layout` preserves columns, but multi-line addresses wrap onto
 * their own lines and leave ragged, partially-empty rows. Rather than parse by
 * column position (fragile), this anchors on the one property every real row
 * has and no continuation line has: it starts with a serial number and ends
 * with two decimal coordinates. Continuation lines are simply skipped.
 * Verified against the current file: 75 Bengaluru rows match, 0 are dropped.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PDF_URL =
  "https://gailgaspdfdownloads.s3.ap-south-1.amazonaws.com/GAILGas-ExistingCNGStations.pdf";

const RAW_DIR = resolve(process.cwd(), "data", "raw");
const PDF_PATH = resolve(RAW_DIR, "gail-existing.pdf");
const TXT_PATH = resolve(RAW_DIR, "gail-existing.txt");
const OUT_PATH = resolve(process.cwd(), "data", "stations-gail.csv");

/** Bangalore bounding box, used to reject mis-parsed coordinates. */
// Greater Bengaluru GA, slightly wider than the city proper: GAIL's licence
// area reaches Doddaballapur/Nandi Hills in the north and Hoskote in the east.
const BOUNDS = { south: 12.6, west: 77.2, north: 13.4, east: 78.0 };

/**
 * One station row: leading serial number, the GA name, then free text, then
 * two decimal coordinates at end of line.
 */
const ROW = /^\s*(\d+)\s+Bengaluru\b\s+(.*?)\s+(\d{1,2}\.\d{3,})\s+(\d{1,2}\.\d{3,})\s*$/;

/** Station models and entities that appear as separate columns before the name. */
const MODELS = ["COCO", "FDODO", "OMC RO", "DODO", "CODO"];
const ENTITIES = ["GAIL Gas", "IOCL", "HPCL", "BPCL", "RBPML", "MRPL"];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Splits the free-text middle of a row into {model, operator, name, address}.
 *
 * The columns run: Model | Entity | Name of CNG Station | Address. Model and
 * Entity come from small known vocabularies, so they can be stripped off the
 * front by matching rather than by guessing at whitespace boundaries.
 */
function splitMiddle(middle) {
  // Deliberately does NOT collapse whitespace yet: the runs of 2+ spaces are
  // the only thing separating the Name and Address columns once pdftotext has
  // flattened the table, so they have to survive until after the split.
  let rest = middle.replace(/\s+$/, "");

  // Built by concatenation rather than a template literal: inside a template
  // literal a lone \s is consumed as a string escape and the RegExp would
  // receive a bare "s", silently matching nothing.
  const stripPrefix = (candidates) => {
    for (const candidate of candidates) {
      const pattern = new RegExp("^\\s*" + candidate + "\\s+", "i");
      if (pattern.test(rest)) {
        rest = rest.replace(pattern, "");
        return candidate;
      }
    }
    return "";
  };

  const model = stripPrefix(MODELS);
  const entity = stripPrefix(ENTITIES);
  const operator = entity === "GAIL Gas" ? "GAIL" : entity;

  // Name and Address are separated by the column gap (2+ spaces). Some rows
  // have no address at all, in which case the whole remainder is the name.
  const parts = rest.trim().split(/\s{2,}/).filter(Boolean);
  const name = (parts.shift() ?? "").replace(/\s+/g, " ").trim();
  const address = parts
    .join(", ")
    .replace(/\s+/g, " ")
    .replace(/(,\s*)+,/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();

  return { model, operator, name, address };
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  process.stdout.write(`Downloading ${PDF_URL}\n`);
  const { stdout: code } = await execFileAsync("curl", [
    "-sS", "-L", "--max-time", "120", "-o", PDF_PATH, "-w", "%{http_code}", PDF_URL,
  ]);
  if (code.trim() !== "200") throw new Error(`Download failed: HTTP ${code}`);

  process.stdout.write("Extracting text (pdftotext -layout)\n");
  await execFileAsync("pdftotext", ["-layout", PDF_PATH, TXT_PATH]);

  const text = await readFile(TXT_PATH, "utf8");
  const lines = text.split(/\r?\n/);

  const stations = [];
  const rejected = [];

  for (const line of lines) {
    const match = ROW.exec(line);
    if (!match) continue;

    const [, serial, middle, latText, lngText] = match;
    const latitude = Number(latText);
    const longitude = Number(lngText);

    if (
      latitude < BOUNDS.south || latitude > BOUNDS.north ||
      longitude < BOUNDS.west || longitude > BOUNDS.east
    ) {
      rejected.push(`Sr ${serial}: (${latitude}, ${longitude}) outside Bangalore`);
      continue;
    }

    const { model, operator, name, address } = splitMiddle(middle);
    if (!name) {
      rejected.push(`Sr ${serial}: no station name`);
      continue;
    }

    stations.push({
      // Stable id so re-running updates rather than duplicating, and so these
      // never collide with the OSM-sourced rows.
      osm_id: `gail/${serial}`,
      name,
      operator,
      address,
      area: "",
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      is_24x7: "false",
      opening_hours: "",
      phone: "",
      needs_review: model ? `model:${model}` : "",
    });
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

  process.stdout.write(
    [
      "",
      `Wrote ${stations.length} Bengaluru station(s) to data/stations-gail.csv`,
      rejected.length ? `  ${rejected.length} row(s) rejected:` : "  0 rejected",
      ...rejected.map((r) => `    - ${r}`),
      "",
      "Source: GAIL Gas 'List of Operational CNG Stations as on 01.03.2023'.",
      "Planned-but-unbuilt stations are deliberately excluded.",
      "",
      "NEXT: node scripts/import-stations.mjs --file data/stations-gail.csv",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exit(1);
});
