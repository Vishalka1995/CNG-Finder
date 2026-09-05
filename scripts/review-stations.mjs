#!/usr/bin/env node
/**
 * Generates a browser-friendly review sheet from data/stations-draft.csv.
 *
 *   node scripts/review-stations.mjs
 *
 * Output: data/stations-review.html -- open it in any browser.
 *
 * WHY THIS EXISTS
 * Reviewing 21 rows of raw lat/lng in a spreadsheet means retyping each
 * coordinate into Google Maps by hand, 21 times. This script does that
 * lookup for you and lays out one clickable satellite-view link per station,
 * next to the fields that actually need a decision (name, operator, address,
 * area, keep-or-delete). It does not modify the CSV -- you still edit
 * data/stations-draft.csv directly; this is a reading aid, not an editor.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CSV_PATH = resolve(process.cwd(), "data", "stations-draft.csv");
const OUT_PATH = resolve(process.cwd(), "data", "stations-review.html");

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
    if (char === '"') inQuotes = true;
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

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return body.map((cells) => {
    const record = {};
    header.forEach((key, i) => {
      record[key.trim()] = (cells[i] ?? "").trim();
    });
    return record;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowHtml(station, index) {
  const lat = station.latitude;
  const lng = station.longitude;
  const flags = (station.needs_review ?? "")
    .split("|")
    .map((f) => f.trim())
    .filter(Boolean);

  const mapsUrl = `https://www.google.com/maps/@${lat},${lng},19z/data=!3m1!1e3`;
  const isLikelyNotCng =
    /lpg/i.test(station.operator) || /lpg/i.test(station.name);

  const flagBadges = flags
    .map((f) => `<span class="flag flag-${f.split("-")[0]}">${escapeHtml(f)}</span>`)
    .join(" ");

  return `
  <tr class="${isLikelyNotCng ? "row-warning" : ""}">
    <td class="idx">${index + 1}</td>
    <td>
      <div class="name">${escapeHtml(station.name || "(no name)")}</div>
      <div class="sub">${escapeHtml(station.operator || "(no operator)")}</div>
      ${isLikelyNotCng ? '<div class="warn">⚠ Possibly LPG, not CNG -- verify and delete if so</div>' : ""}
    </td>
    <td>
      <a class="maplink" href="${mapsUrl}" target="_blank" rel="noopener">
        📍 View satellite
      </a>
      <div class="coords">${lat}, ${lng}</div>
    </td>
    <td>${flagBadges || "<span class=\"flag flag-ok\">looks complete</span>"}</td>
    <td class="osm">${escapeHtml(station.osm_id)}</td>
  </tr>`;
}

async function main() {
  const csvText = await readFile(CSV_PATH, "utf8");
  const stations = parseCSV(csvText);

  const flaggedCount = stations.filter((s) => (s.needs_review ?? "").trim()).length;
  const likelyNonCng = stations.filter(
    (s) => /lpg/i.test(s.operator) || /lpg/i.test(s.name),
  );

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CNG Now -- station review</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #F8FAFC; color: #0F172A; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .summary { color: #64748B; font-size: 14px; margin-bottom: 20px; }
  .summary strong { color: #0F172A; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th { text-align: left; font-size: 12px; text-transform: uppercase; color: #64748B; padding: 12px 16px; border-bottom: 2px solid #E2E8F0; }
  td { padding: 14px 16px; border-bottom: 1px solid #F1F5F9; vertical-align: top; font-size: 14px; }
  .idx { color: #94A3B8; font-variant-numeric: tabular-nums; }
  .name { font-weight: 600; }
  .sub { color: #64748B; font-size: 13px; margin-top: 2px; }
  .warn { color: #B45309; font-size: 12px; margin-top: 6px; font-weight: 600; }
  .maplink { display: inline-block; background: #00A86B; color: white; text-decoration: none; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; }
  .maplink:hover { background: #018f5c; }
  .coords { color: #94A3B8; font-size: 11px; margin-top: 6px; font-family: monospace; }
  .flag { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 999px; margin: 2px 2px 0 0; }
  .flag-no { background: #FEF3C7; color: #92400E; }
  .flag-way { background: #FEE2E2; color: #991B1B; }
  .flag-ok { background: #DCFCE7; color: #166534; }
  .osm { color: #94A3B8; font-size: 12px; font-family: monospace; }
  .row-warning { background: #FFFBEB; }
</style>
</head>
<body>
  <h1>CNG Now — station review</h1>
  <p class="summary">
    <strong>${stations.length}</strong> stations from OpenStreetMap ·
    <strong>${flaggedCount}</strong> flagged for review ·
    <strong>${likelyNonCng.length}</strong> possibly not CNG
  </p>
  <p class="summary">
    Click <strong>📍 View satellite</strong> to open Google Maps at that exact spot. If the pin
    is not sitting on the actual fuel station forecourt, fix the coordinates in
    <code>data/stations-draft.csv</code> before importing -- the app rejects reports made more
    than 300&nbsp;m from a station's pin, so a wrong coordinate makes that station permanently
    unreportable.
  </p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Station</th>
        <th>Location</th>
        <th>Flags</th>
        <th>OSM ID</th>
      </tr>
    </thead>
    <tbody>
      ${stations.map(rowHtml).join("\n")}
    </tbody>
  </table>
</body>
</html>`;

  await writeFile(OUT_PATH, html, "utf8");

  process.stdout.write(
    [
      "",
      `Wrote data/stations-review.html`,
      `  ${stations.length} stations, ${flaggedCount} flagged, ${likelyNonCng.length} possibly not CNG`,
      "",
      "Open it in a browser and click through each satellite link.",
      "Edit data/stations-draft.csv directly with what you find --",
      "this review sheet is read-only, it does not write back to the CSV.",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exit(1);
});
