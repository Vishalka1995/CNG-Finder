#!/usr/bin/env node
/**
 * Fetches candidate CNG stations from OpenStreetMap and writes a CSV for
 * manual review.
 *
 *   node scripts/fetch-osm-stations.mjs --states=IN-MH,IN-KA
 *   node scripts/fetch-osm-stations.mjs --bbox=bangalore
 *
 * Output: data/stations-draft.csv (override with --out=<path>)
 *
 * WHY A REVIEW STEP EXISTS
 * OSM coverage of Indian CNG stations is partial and its coordinates are often
 * the road centreline rather than the forecourt. Because the app enforces a
 * 300 m proximity rule before accepting a report, a pin that is 400 m off makes
 * a station permanently unreportable. So this script deliberately produces a
 * DRAFT for a human to correct -- it never writes to the database.
 *
 * The `needs_review` column flags rows that are most likely to be wrong.
 *
 * WHY STATES RATHER THAN BOUNDING BOXES
 * A rectangle around Maharashtra also contains chunks of Gujarat, Madhya
 * Pradesh and Telangana, so a bbox pull quietly imports stations from states
 * we did not ask for and then double-counts them on the next state's run.
 * Querying the admin boundary instead returns exactly the state, and lets each
 * row record which state it came from.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Overpass answers a request with no User-Agent with a bare `406 Not
 * Acceptable`, which looks exactly like a proxy or TLS failure and is slow to
 * diagnose from the symptom. Always send one.
 */
const USER_AGENT = "CNGNow/1.0 (CNG station data import)";

/** Named bounding boxes, kept for local testing: south, west, north, east. */
const BBOXES = {
  bangalore: [12.7342, 77.3791, 13.1739, 77.8826],
};

/** ISO 3166-2 codes we import, mapped to the name written into the CSV. */
const STATE_NAMES = {
  "IN-MH": "Maharashtra",
  "IN-KA": "Karnataka",
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * The several ways CNG availability is tagged in OSM. `amenity=fuel` alone
 * would return every petrol pump in the country, so each clause requires a
 * CNG-specific tag.
 *
 * This is also what correctly picks up ordinary petrol pumps that happen to
 * also sell CNG: they carry `amenity=fuel` plus `fuel:cng=yes`, exactly like a
 * dedicated CNG station, so no separate handling is needed for them.
 */
function selectors(scope) {
  return [
    `nwr["amenity"="fuel"]["fuel:cng"="yes"](${scope});`,
    `nwr["amenity"="fuel"]["fuel:CNG"="yes"](${scope});`,
    `nwr["amenity"="fuel"]["fuel"="cng"](${scope});`,
    `nwr["amenity"="fuel"]["cng"="yes"](${scope});`,
    // Stations whose NAME says CNG but which nobody has tagged yet. Kept
    // separate because these are candidates, not confirmations -- cngStatus()
    // decides, and flags them for review.
    `nwr["amenity"="fuel"]["name"~"CNG",i](${scope});`,
  ].join("\n  ");
}

function queryForState(iso) {
  return `
[out:json][timeout:300];
area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.s;
(
  ${selectors("area.s")}
);
out center tags;
`;
}

function queryForBbox(bbox) {
  return `
[out:json][timeout:300];
(
  ${selectors(bbox.join(","))}
);
out center tags;
`;
}

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
  if (raw.includes("mahanagar") || raw.includes("mgl")) return "Mahanagar Gas";
  if (raw.includes("mngl")) return "MNGL";
  if (raw.includes("torrent")) return "Torrent Gas";
  if (raw.includes("adani")) return "Adani Total Gas";
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
 *
 * Returns raw text rather than parsed JSON: an overloaded Overpass replies with
 * HTTP 200 and an HTML error body, and the caller needs to see that.
 */
async function postOverpass(endpoint, body) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    const cause = error?.cause;
    const looksLikeTls =
      error.message === "fetch failed" ||
      String(cause?.message ?? "").includes("certificate") ||
      String(cause?.code ?? "").includes("CERT");

    if (!looksLikeTls) throw error;

    const { stdout } = await execFileAsync(
      "curl",
      [
        "-sS",
        "--max-time",
        "300",
        "-X",
        "POST",
        "-A",
        USER_AGENT,
        "-H",
        "Content-Type: application/x-www-form-urlencoded",
        "--data-binary",
        body,
        endpoint,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    return stdout;
  }
}

/**
 * Runs one Overpass query, retrying while the public instance is merely busy.
 *
 * Overpass answers an overloaded request with HTTP 200 and an HTML body
 * containing "runtime error" rather than an error status, so a naive
 * JSON.parse throws something unrelated and the real cause is lost. A short
 * backoff clears it nearly every time.
 */
async function runQuery(query, label) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const text = await postOverpass(endpoint, body);

        if (text.trimStart().startsWith("{")) return JSON.parse(text);

        const detail =
          /Error<\/strong>:([^<]*)/.exec(text)?.[1]?.trim() ?? "non-JSON reply";
        lastError = new Error(detail.slice(0, 120));
        process.stdout.write(
          `  ${label}: server busy (attempt ${attempt}) -- ${lastError.message}\n`,
        );
      } catch (error) {
        lastError = error;
        process.stdout.write(`  ${label}: ${error.message}\n`);
      }
    }

    await new Promise((done) => setTimeout(done, attempt * 5000));
  }

  throw new Error(`${label} failed after retries: ${lastError?.message ?? "unknown"}`);
}

/**
 * Flags rows that look like an LPG or auto-gas outlet rather than CNG.
 *
 * The Overpass query already demands a CNG tag, so everything here claims to
 * sell CNG -- but OSM is crowd-mapped and "fuel:cng" gets applied to LPG
 * autogas pumps by mistake fairly often. A driver sent to an LPG pump for CNG
 * has been sent to the wrong place entirely, so these are surfaced for a human
 * to confirm rather than dropped automatically (some are genuinely both).
 */
/** The tag keys OSM uses, in practice, to record CNG availability. */
const CNG_KEYS = ["fuel:cng", "fuel:CNG", "fuel:Cng", "cng", "fuel:compressed_natural_gas"];

/**
 * Decides whether a place actually sells CNG.
 *
 * The rule this encodes: a petrol or diesel pump that ALSO sells CNG belongs
 * in the app, but a station with no CNG must never appear -- sending a driver
 * who is low on gas to a pump that cannot fill them is the worst failure this
 * app has. So the three outcomes are kept distinct:
 *
 *   "denied"    - tagged fuel:cng=no. An audit of Maharashtra and Karnataka
 *                 found 25 of these. They are dropped outright, and this check
 *                 runs FIRST so that nothing below can override it.
 *   "confirmed" - tagged as selling CNG. Imported normally.
 *   "named"     - untagged, but "CNG" appears in the name as a whole word
 *                 ("Ashoka CNG Pump", "GAIL Gas CNG Station"). Imported, but
 *                 flagged cng-name-only for a human to confirm.
 *
 * Trusting the name is not a guess: across both states, of the 25 stations
 * explicitly tagged fuel:cng=no, NONE had "CNG" in the name -- so the name has
 * never contradicted an explicit denial in this data.
 */
function cngStatus(tags) {
  for (const key of CNG_KEYS) {
    const value = tags[key];
    if (value !== undefined && /^(no|false|0)$/i.test(String(value))) return "denied";
  }

  for (const key of CNG_KEYS) {
    const value = tags[key];
    if (value !== undefined && /^(yes|only|true|1)$/i.test(String(value))) return "confirmed";
  }

  if (tags.fuel === "cng") return "confirmed";

  // Whole word only: "CNG" must not match inside an unrelated word.
  if (/\bCNG\b/i.test(tags.name ?? "")) return "named";

  return "denied";
}

function looksLikeLpg(tags) {
  const haystack = [tags.name, tags.operator, tags.brand]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(lpg|auto ?gas|autogas|totalgaz|petronas)\b/.test(haystack)) return true;

  // Tagged for LPG and not independently confirmed for CNG.
  return tags["fuel:lpg"] === "yes" && tags["fuel:cng"] !== "yes";
}

function toRow(element, stateName) {
  const tags = element.tags ?? {};

  // The CNG gate, before anything else: no CNG, no row.
  const cng = cngStatus(tags);
  if (cng === "denied") return null;

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
  if (looksLikeLpg(tags)) problems.push("possible-lpg");
  if (cng === "named") problems.push("cng-name-only");

  const hours = tags.opening_hours ?? "";
  const is24x7 = hours === "24/7" ? "true" : "false";

  return {
    osm_id: `${element.type}/${element.id}`,
    name,
    operator,
    address,
    area: tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? tags["addr:city"] ?? "",
    state: tags["addr:state"] || stateName,
    latitude: Number(latitude).toFixed(6),
    longitude: Number(longitude).toFixed(6),
    is_24x7: is24x7,
    opening_hours: hours,
    phone: tags.phone ?? tags["contact:phone"] ?? "",
    needs_review: problems.join("|"),
  };
}

/** Parses a `--key=value` flag. */
function flag(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const statesArg = flag("states");
  const bboxArg = flag("bbox");
  const outPathArg = flag("out") ?? "data/stations-draft.csv";

  /** Each entry becomes one Overpass query. */
  const jobs = [];

  if (statesArg) {
    for (const iso of statesArg.split(",").map((s) => s.trim()).filter(Boolean)) {
      jobs.push({
        label: STATE_NAMES[iso] ?? iso,
        stateName: STATE_NAMES[iso] ?? "",
        query: queryForState(iso),
      });
    }
  } else {
    const key = bboxArg ?? "bangalore";
    const bbox = BBOXES[key];
    if (!bbox) {
      throw new Error(`Unknown bbox "${key}". Known: ${Object.keys(BBOXES).join(", ")}`);
    }
    jobs.push({ label: key, stateName: "", query: queryForBbox(bbox) });
  }

  const rows = [];

  for (const job of jobs) {
    process.stdout.write(`Querying ${job.label}\n`);
    const data = await runQuery(job.query, job.label);
    const elements = data.elements ?? [];
    const mapped = elements.map((el) => toRow(el, job.stateName)).filter(Boolean);
    process.stdout.write(`  ${mapped.length} station(s)\n`);
    rows.push(...mapped);
  }

  // Deduplicate: a site tagged as both a node and an enclosing way appears
  // twice, and a station sitting on a state border comes back from both runs.
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
    "state",
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

  await writeFile(resolve(process.cwd(), outPathArg), `${csv}\n`, "utf8");

  const flagged = unique.filter((row) => row.needs_review).length;

  process.stdout.write(
    [
      "",
      `Wrote ${unique.length} station(s) to ${outPathArg}`,
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
      `THEN: node scripts/import-stations.mjs --file ${outPathArg}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\nFailed: ${error.message}\n`);
  process.exit(1);
});
