#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/**
 * Writes test/fixtures/db/oldest-supported.db — roadmap 10.3.
 *
 * Every other test starts from an empty database, so none of them would notice
 * a migration that breaks an installation a year old. This one is the year-old
 * installation: the schema the oldest supported release created, filled with
 * the kind of data an operator running it would have by now.
 *
 * The schema is not retyped here. The release's own `migrate.ts` and `seed.ts`
 * are read out of git at its tag and run, so the file is what that release
 * wrote, not what someone remembered it writing. Only the rows are written
 * with SQL, against that release's columns.
 *
 *   node tools/oldest-db.mjs
 *
 * When the minimum supported release is raised, change `OLDEST_TAG`, run this
 * and commit the regenerated fixture on its own (docs/development.md).
 */

/** The oldest release whose database a current build must open: v1.0.0, schema 7. */
const OLDEST_TAG = "v1.0.0";

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = join(ROOT, "test/fixtures/db/oldest-supported.db");

/** The visual harness's frozen instant (tools/visual/fixture.mjs), so its frames can be drawn of this file. */
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();

const PROVIDERS = [
  { id: "github", name: "GitHub", baseUrl: "https://www.githubstatus.com", status: "operational" },
  { id: "cloudflare", name: "Cloudflare", baseUrl: "https://www.cloudflarestatus.com", status: "degraded" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://status.claude.com", status: "major_outage" },
  { id: "vercel", name: "Vercel", baseUrl: "https://www.vercel-status.com", status: "operational" },
];

const COMPONENTS = {
  github: [
    { id: "git", name: "Git Operations", status: "operational" },
    { id: "actions", name: "Actions", status: "operational" },
  ],
  cloudflare: [
    { id: "cdn", name: "CDN", status: "degraded" },
    { id: "dns", name: "Authoritative DNS", status: "operational" },
  ],
  anthropic: [{ id: "api", name: "Claude API", status: "major_outage" }],
};

function releaseModules() {
  const dir = mkdtempSync(join(tmpdir(), "isitdown-oldest-"));
  for (const file of ["migrate.ts", "seed.ts"]) {
    const source = execFileSync("git", ["show", `${OLDEST_TAG}:src/ui/db/${file}`], { cwd: ROOT, encoding: "utf8" });
    writeFileSync(join(dir, file), source);
  }
  return dir;
}

function seed(db) {
  const insertService = db.prepare(
    "INSERT OR REPLACE INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, ?, 0, ?)",
  );
  const insertState = db.prepare(
    "INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, fetched_at, failure_count, degraded_notified) VALUES (?, ?, ?, ?, ?, 0, ?)",
  );
  const insertSample = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, ?, ?)",
  );
  const insertComponentSample = db.prepare(
    "INSERT INTO component_samples (provider_id, component_id, observed_at, status, ok) VALUES (?, ?, ?, ?, ?)",
  );
  const insertIncident = db.prepare(
    "INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertNotification = db.prepare(
    "INSERT INTO notifications (provider_id, channel, kind, text, sent_at, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  const open = {
    id: "fixture-open-1",
    name: "Elevated error rates on the API",
    impact: "major",
    status: "investigating",
    updatedAt: iso(2 * 3600_000),
  };

  for (const provider of PROVIDERS) {
    const components = COMPONENTS[provider.id] ?? [];
    insertService.run(
      provider.id,
      provider.name,
      provider.baseUrl,
      components.length > 0 ? JSON.stringify(components.map(({ id, name }) => ({ id, name }))) : null,
      iso(120 * DAY),
    );
    insertState.run(
      provider.id,
      provider.status,
      provider.status === "major_outage" ? JSON.stringify([open]) : "[]",
      JSON.stringify(components),
      iso(3 * 60_000),
      provider.status === "operational" ? 0 : 1,
    );

    // Three months at the release's default cadence would be 43,000 rows per
    // provider; four a day keeps the file small and still fills every bar.
    for (let day = 89; day >= 0; day -= 1) {
      const bad = provider.id === "anthropic" && day < 2;
      const wobbly = provider.id === "cloudflare" && day % 17 === 0;
      const status = bad ? "major_outage" : wobbly ? "degraded" : "operational";
      for (const hour of [2, 8, 14, 20]) {
        const at = new Date(NOW - day * DAY + (hour - 12) * 3600_000).toISOString();
        insertSample.run(provider.id, at, status, status === "operational" ? 1 : 0);
        for (const component of components) {
          const componentStatus = status === "operational" ? "operational" : component.status;
          insertComponentSample.run(provider.id, component.id, at, componentStatus, componentStatus === "operational" ? 1 : 0);
        }
      }
    }
  }

  insertIncident.run("anthropic", open.id, open.name, open.impact, open.status, iso(2 * 3600_000), iso(2 * 3600_000), null);
  insertIncident.run(
    "cloudflare",
    "fixture-resolved-1",
    "Increased latency in EU regions",
    "minor",
    "resolved",
    iso(9 * DAY),
    iso(9 * DAY - 3600_000),
    iso(9 * DAY - 3600_000),
  );
  insertIncident.run(
    "github",
    "fixture-resolved-2",
    "Degraded performance for Actions",
    "minor",
    "resolved",
    iso(40 * DAY),
    iso(40 * DAY - 5400_000),
    iso(40 * DAY - 5400_000),
  );

  for (const row of [
    ["anthropic", "telegram", "incident_opened", "🔴 Anthropic — major outage", iso(2 * 3600_000), 1, null],
    ["cloudflare", "telegram", "status_change", "🟠 Cloudflare — degraded", iso(3 * 3600_000), 1, null],
    ["github", "telegram", "incident_resolved", "🟢 GitHub — operational", iso(40 * DAY - 5400_000), 1, null],
    ["cloudflare", "webhook", "status_change", "🟠 Cloudflare — degraded", iso(3 * 3600_000), 0, "HTTP 502"],
  ]) {
    insertNotification.run(...row);
  }

  // The operator set Telegram up, as anyone running it for a year has: an
  // installation with no channel enabled is the first-run wizard's case.
  db.prepare("UPDATE channels SET enabled = 1 WHERE id = 'telegram'").run();
  db.prepare("UPDATE settings SET value = '5' WHERE key = 'pollIntervalMinutes'").run();
}

async function main() {
  const dir = releaseModules();
  try {
    const { migrate } = await import(pathToFileURL(join(dir, "migrate.ts")).href);
    const { seedDefaults } = await import(pathToFileURL(join(dir, "seed.ts")).href);

    mkdirSync(join(ROOT, "test/fixtures/db"), { recursive: true });
    rmSync(OUT, { force: true });
    // Rollback journal, not WAL: the fixture is one file with nothing beside it.
    const db = new DatabaseSync(OUT);
    try {
      db.exec("PRAGMA foreign_keys = ON");
      migrate(db);
      db.exec("BEGIN");
      // First, as that release's first boot ran it: its settings and channel
      // rows are the ones `seed` then changes the way an operator would.
      seedDefaults(db);
      seed(db);
      db.exec("COMMIT");
      db.exec("VACUUM");
      const [{ user_version }] = db.prepare("PRAGMA user_version").all();
      console.log(`wrote ${OUT} — ${OLDEST_TAG}, schema ${user_version}`);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
