#!/usr/bin/env node
/**
 * Apply every migration in scripts/migrate-*.sql that has not been applied yet.
 *
 *   npm run migrate          against the local dev database
 *   npm run migrate:remote   against the live one
 *
 * Which files have run is recorded in a `schema_migrations` table, one row per
 * file, so each migration runs exactly once. That is what makes a migration
 * that drops and rebuilds a table safe to keep in the folder: it will not be
 * run a second time on the next deploy.
 *
 * Databases from before this table existed have migrations applied but
 * unrecorded. Replaying them is not harmless — 006 re-adds a member for every
 * voter, including people since taken off the list — so on a database with an
 * empty tracking table each file is first checked against a query that only
 * succeeds once it has run (PROOF below), and recorded without running if the
 * proof holds. A file with no proof, or whose proof fails, runs normally.
 *
 * Statements run one at a time rather than as a file, so a migration that is
 * half applied finishes rather than failing whole. If the tracking table
 * cannot be read the run stops before touching anything — guessing here is how
 * a table gets rebuilt twice.
 *
 * Files are numbered because they are ordered: 004 alters a table 002 creates.
 */
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { splitStatements } from "./sql-split.mjs";

const run = promisify(execFile);
const DIR = new URL("./", import.meta.url);
const DB = "london-votes";
const remote = process.argv.includes("--remote");
const where = remote ? "--remote" : "--local";

const ALREADY = /duplicate column name|already exists/i;

/** For a database that predates the tracking table: what proves a file ran. */
const PROOF = {
  "migrate-001-bookings.sql":       "SELECT 1 FROM booking_status LIMIT 0",
  "migrate-002-plan-notes.sql":     "SELECT 1 FROM plan_notes LIMIT 0",
  "migrate-003-custom-address.sql": "SELECT address FROM custom_sights LIMIT 0",
  "migrate-004-note-address.sql":   "SELECT address FROM plan_notes LIMIT 0",
  "migrate-005-trip-base.sql":      "SELECT base_lat FROM trip_settings LIMIT 0",
  "migrate-006-trip.sql":           "SELECT 1 FROM trip_travel LIMIT 0",
  "migrate-007-trips.sql":          "SELECT trip_id FROM trip_travel LIMIT 0",
  // 008 onwards only ever meet a database that already tracks itself.
};

const kindOf = (sql) =>
  /^alter\s+table/i.test(sql) ? "alter"
  : /^create\s+(table|index|unique)/i.test(sql) ? "create"
  : "other";

async function wrangler(args) {
  return run("npx", ["--yes", "wrangler@4", "d1", "execute", DB, where, ...args],
             { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
}

async function execute(sql) {
  const kind = kindOf(sql);
  try {
    await wrangler(["--command", sql]);
    return kind === "create" ? "ensured" : "applied";
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
    // An ALTER that has already run says so; that is a skip, not a failure.
    if (ALREADY.test(text)) return "skipped";
    throw new Error(text.trim().split("\n").slice(-6).join("\n"));
  }
}

/** Rows from a SELECT, via wrangler's JSON output. Throws if it cannot be read. */
async function query(sql) {
  const { stdout } = await wrangler(["--json", "--command", sql]);
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error(`Could not read the result of: ${sql}\n${stdout}`);
  const parsed = JSON.parse(stdout.slice(start));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first?.success) throw new Error(`Query failed: ${sql}`);
  return first.results ?? [];
}

const files = (await readdir(DIR))
  .filter((f) => /^migrate-\d{3}-.+\.sql$/.test(f))
  .sort();   // the numbers make this the intended order, not just a stable one

const unnumbered = (await readdir(DIR))
  .filter((f) => f.startsWith("migrate-") && f.endsWith(".sql") && !files.includes(f));
if (unnumbered.length) {
  console.error(`Unnumbered migrations, so their order is undefined:\n  ${unnumbered.join("\n  ")}`);
  console.error("Rename them migrate-NNN-name.sql.");
  process.exit(1);
}

if (!files.length) {
  console.log("No migrations found.");
  process.exit(0);
}

console.log(`${files.length} migration${files.length === 1 ? "" : "s"} → ${remote ? "REMOTE (live)" : "local"}\n`);

let done;
try {
  await execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  done = new Set((await query("SELECT name FROM schema_migrations")).map((r) => r.name));
} catch (err) {
  console.error(`Could not read which migrations have run, so nothing was changed.\n${err.message}`);
  process.exit(1);
}

let applied = 0, skipped = 0, ensured = 0, recorded = 0;

const record = (file) => execute(
  `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('${file}', ${Date.now()})`);

// Nothing recorded yet, but tables exist: an older database. Work out what has
// already run from the shape of the schema, and record it without replaying.
if (done.size === 0) {
  for (const file of files) {
    if (!PROOF[file]) continue;
    let holds = false;
    try { await query(PROOF[file]); holds = true; } catch { /* not yet applied */ }
    if (holds) {
      await record(file);
      done.add(file);
      console.log(`  recorded   ${file.padEnd(32)} already applied before tracking existed`);
    }
  }
  if (done.size) console.log("");
}

for (const file of files) {
  if (done.has(file)) {
    console.log(`  done       ${file}`);
    continue;
  }

  // Split with a proper walk, not on every semicolon: a place's summary can
  // contain one, and a URL is a hyphen away from looking like a comment.
  const statements = splitStatements(await readFile(new URL(file, DIR), "utf8"));

  const results = [];
  for (const statement of statements) {
    try {
      results.push(await execute(statement));
    } catch (err) {
      console.error(`\n  ${file}\n  FAILED on:\n    ${statement.replace(/\s+/g, " ").slice(0, 100)}\n\n${err.message}\n`);
      console.error("Nothing after this point was run, and this file was not recorded as applied.");
      process.exit(1);
    }
  }

  await record(file);
  recorded++;

  const a = results.filter((r) => r === "applied").length;
  const sk = results.filter((r) => r === "skipped").length;
  const en = results.filter((r) => r === "ensured").length;
  applied += a; skipped += sk; ensured += en;

  const parts = [a && `${a} applied`, sk && `${sk} already there`, en && `${en} ensured`]
    .filter(Boolean).join(", ");
  console.log(`  ${(a ? "changed   " : "no change ")} ${file.padEnd(32)} ${parts}`);
}

console.log(`\n${recorded} recorded, ${applied} statements applied, ${skipped} already in place, ${ensured} tables/indexes ensured.`);
if (remote && applied) console.log("Remember the live Worker has to be deployed for new columns to be used.");
