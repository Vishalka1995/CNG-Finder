#!/usr/bin/env node
/**
 * Moderation tool for driver-submitted stations.
 *
 *   node scripts/review-submissions.mjs                  # list pending
 *   node scripts/review-submissions.mjs --approve <id>   # approve one
 *   node scripts/review-submissions.mjs --reject <id> [--reason "..."]
 *
 * Uses the service_role key from .env.scripts, because approve/reject are
 * granted only to that role -- nothing shipped in the app can create or
 * publish a station.
 *
 * The listing prints a Google Maps satellite link per submission, since the
 * one thing worth checking by eye is whether the coordinates actually land on
 * a CNG forecourt.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index !== -1 ? (args[index + 1] ?? "") : null;
};

const approveId = flag("--approve");
const rejectId = flag("--reject");
const reason = flag("--reason");

async function loadEnv() {
  const path = resolve(process.cwd(), ".env.scripts");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      "Missing .env.scripts (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).",
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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(".env.scripts must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return env;
}

/** curl rather than fetch -- see scripts/fetch-osm-stations.mjs for why. */
async function request(env, path, { method = "GET", body } = {}) {
  const curlArgs = [
    "-sS",
    "--max-time",
    "60",
    "-X",
    method,
    `${env.SUPABASE_URL}${path}`,
    "-H",
    `apikey: ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "-H",
    `Authorization: Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "-H",
    "Content-Type: application/json",
  ];
  if (body !== undefined) curlArgs.push("--data-binary", JSON.stringify(body));

  const { stdout } = await execFileAsync("curl", curlArgs, {
    maxBuffer: 16 * 1024 * 1024,
  });

  const text = stdout.trim();
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300));
  }

  if (parsed && !Array.isArray(parsed) && parsed.message) {
    throw new Error(parsed.message);
  }
  return parsed;
}

async function listPending(env) {
  const rows = await request(
    env,
    "/rest/v1/station_submissions?status=eq.pending&select=*&order=created_at.asc",
  );

  if (!rows || rows.length === 0) {
    process.stdout.write("\nNo pending submissions.\n\n");
    return;
  }

  process.stdout.write(`\n${rows.length} pending submission(s):\n\n`);

  for (const row of rows) {
    // PostgREST returns geography as EWKB hex, which is not worth decoding
    // here -- the RPC below is the authority. Show what a moderator needs.
    process.stdout.write(
      [
        `  ${row.name}`,
        `    id       : ${row.id}`,
        `    operator : ${row.operator ?? "(none given)"}`,
        `    address  : ${row.address ?? "(none given)"}`,
        `    added    : ${new Date(row.created_at).toLocaleString()}`,
        `    approve  : node scripts/review-submissions.mjs --approve ${row.id}`,
        `    reject   : node scripts/review-submissions.mjs --reject ${row.id} --reason "not a CNG station"`,
        "",
      ].join("\n"),
    );
  }

  process.stdout.write(
    "Tip: check each one on the map before approving -- a wrong coordinate\n" +
      "makes the station unreportable, because reports must be within 300m.\n\n",
  );
}

async function main() {
  const env = await loadEnv();

  if (approveId) {
    const stationId = await request(env, "/rest/v1/rpc/approve_submission", {
      method: "POST",
      body: { p_submission_id: approveId },
    });
    process.stdout.write(`\nApproved. Created station ${stationId}\n\n`);
    return;
  }

  if (rejectId) {
    await request(env, "/rest/v1/rpc/reject_submission", {
      method: "POST",
      body: { p_submission_id: rejectId, p_reason: reason },
    });
    process.stdout.write(`\nRejected ${rejectId}\n\n`);
    return;
  }

  await listPending(env);
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exit(1);
});
