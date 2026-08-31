#!/usr/bin/env node
/**
 * Apply every migration in scripts/migrate-*.sql, skipping the ones already
 * applied.
 *
 *   npm run migrate          against the local dev database
 *   npm run migrate:remote   against the live one
 *
 * Safe to run every time you deploy, which is the point: four scripts to
 * remember by hand is three too many, and the one you forget is the one that
 * takes the site down.
 *
 * Statements run one at a time rather than as a file, so a migration that is
 * half applied — two of its three columns already there — finishes rather than
 * failing whole. "Duplicate column" and "already exists" mean the work is done;
 * anything else stops the run.
 *
 * Files are numbered because they are ordered: 004 alters a table 002 creates.
 * Sorting them by name alphabetically ran 004 first and failed on a database
 * old enough to need both.
 */
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const DIR = new URL("./", import.meta.url);
const DB = "london-votes";
const remote = process.argv.includes("--remote");

const ALREADY = /duplicate column name|already exists/i;

/**
 * Whether a statement did anything depends on what kind it is:
 *
 *   ALTER TABLE ADD COLUMN  succeeds once, then errors "duplicate column" —
 *                           so success means applied, that error means skipped
 *   CREATE ... IF NOT EXISTS  succeeds either way and reports nothing useful
 *                           (changed_db is false for DDL), so it is only ever
 *                           "ensured" — which is fine, because it is harmless
 *
 * Guessing from changed_db looked cleaner and was simply wrong: it reported a
 * freshly migrated database as already up to date.
 */
const kindOf = (sql) =>
  /^alter\s+table/i.test(sql) ? "alter"
  : /^create\s+(table|index|unique)/i.test(sql) ? "create"
  : "other";

async function execute(sql) {
  const kind = kindOf(sql);
  try {
    await run("npx", ["--yes", "wrangler@4", "d1", "execute", DB,
                      remote ? "--remote" : "--local", "--command", sql],
              { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
    return kind === "create" ? "ensured" : "applied";
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
    // An ALTER that has already run says so; that is a skip, not a failure.
    if (ALREADY.test(text)) return "skipped";
    throw new Error(text.trim().split("\n").slice(-6).join("\n"));
  }
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

let applied = 0, skipped = 0, ensured = 0;

for (const file of files) {
  const sql = await readFile(new URL(file, DIR), "utf8");
  // Strip comments so a semicolon inside one can't split a statement.
  const statements = sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  for (const statement of statements) {
    try {
      results.push(await execute(statement));
    } catch (err) {
      console.error(`\n  ${file}\n  FAILED on:\n    ${statement.replace(/\s+/g, " ").slice(0, 100)}\n\n${err.message}\n`);
      process.exit(1);
    }
  }

  const a = results.filter((r) => r === "applied").length;
  const sk = results.filter((r) => r === "skipped").length;
  const en = results.filter((r) => r === "ensured").length;
  applied += a;
  skipped += sk;
  ensured += en;

  const parts = [a && `${a} applied`, sk && `${sk} already there`, en && `${en} ensured`]
    .filter(Boolean).join(", ");
  console.log(`  ${(a ? "changed   " : "no change ")} ${file.padEnd(32)} ${parts}`);
}

console.log(`\n${applied} applied, ${skipped} already in place, ${ensured} tables/indexes ensured.`);
if (remote && applied) console.log("Remember the live Worker has to be deployed for new columns to be used.");
