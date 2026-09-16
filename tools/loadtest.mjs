// A fleet nobody has: 200 providers and a week of history, synthesised, then
// every read the dashboard makes timed against it — roadmap 7.4.
//
// The question this answers is not "is it fast", it is "where does it stop
// being fast": at what fleet size and retention do the SQLite reads behind the
// overview and the history charts start costing seconds. Nothing here talks to
// a provider, and nothing is left behind: the database is built in a temp
// directory and deleted.
//
// Run it with `npm run test:load`, not in CI: it writes hundreds of thousands
// of rows and takes about a minute. The budgets below are generous on purpose —
// they are a tripwire for an order-of-magnitude regression (an index dropped, a
// query that started scanning), not a benchmark to tune against.
import { mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildUiRuntime } from "../src/ui/runtime.ts";
import { createLogger } from "../src/core/logger.ts";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  }),
);

const PROVIDERS = Number(options["providers"] ?? 200);
const DAYS = Number(options["days"] ?? 7);
const INTERVAL_MINUTES = Number(options["interval"] ?? 3);
const RUNS = Number(options["runs"] ?? 20);

/** p95 ceilings, in milliseconds. A tripwire, not a target — see the header. */
const BUDGET_MS = {
  "/status": 1500,
  "/history?days=7": 4000,
  "/history?days=30": 4000,
  "/history?days=90": 4000,
  "/incidents?page=1": 1500,
  "/notifications/log": 1500,
  "/metrics": 1500,
  "/widget": 1500,
  "/homeassistant": 1500,
};

const STATUSES = ["operational", "operational", "operational", "degraded", "major_outage"];

const dir = await mkdtemp(join(tmpdir(), "isitdown-load-"));
const dbPath = join(dir, "isitdown.db");
const silent = createLogger("error", () => {});

console.log(
  `synthesising ${PROVIDERS} providers × ${DAYS} day(s) at ${INTERVAL_MINUTES}-minute cadence …`,
);

// Built through the real runtime first, so the schema is the migrated one
// rather than a copy of it that can drift.
const seeding = await buildUiRuntime({ dbPath, env: {}, logger: silent });
await seeding.close();

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
const now = Date.now();
const samplesPerProvider = Math.floor((DAYS * 24 * 60) / INTERVAL_MINUTES);

const insertService = db.prepare(
  "INSERT OR REPLACE INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, NULL, 0, ?)",
);
const insertSample = db.prepare(
  "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok, latency_ms) VALUES (?, ?, ?, ?, ?)",
);
const insertIncident = db.prepare(
  "INSERT OR REPLACE INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const insertState = db.prepare(
  "INSERT OR REPLACE INTO provider_state (provider_id, overall_status, active_incidents, fetched_at, failure_count, degraded_notified) VALUES (?, ?, '[]', ?, 0, 0)",
);

const startedSeeding = Date.now();
db.exec("BEGIN");
for (let index = 0; index < PROVIDERS; index += 1) {
  const id = `provider-${String(index).padStart(3, "0")}`;
  insertService.run(id, `Provider ${index}`, `https://status-${index}.example.com`, new Date(now).toISOString());
  insertState.run(id, "operational", new Date(now).toISOString());

  for (let sample = 0; sample < samplesPerProvider; sample += 1) {
    const at = new Date(now - sample * INTERVAL_MINUTES * 60_000).toISOString();
    // Deterministic rather than random: two runs of this script have to be
    // comparable, and a benchmark whose data changes between runs measures
    // the data as much as the code.
    const status = STATUSES[(index + sample) % STATUSES.length];
    insertSample.run(id, at, status, status === "operational" ? 1 : 0, 120 + ((index + sample) % 400));
  }

  // One incident a day per provider, half of them still open: the incident
  // list's pager and its counts are as much of the load as the samples are.
  for (let day = 0; day < DAYS; day += 1) {
    const startedAt = new Date(now - day * 86_400_000).toISOString();
    insertIncident.run(
      id,
      `i-${day}`,
      `Elevated error rates on ${id}`,
      day % 2 === 0 ? "major" : "minor",
      day % 2 === 0 ? "investigating" : "resolved",
      startedAt,
      startedAt,
      day % 2 === 0 ? null : startedAt,
    );
  }
}
db.exec("COMMIT");
db.exec("ANALYZE");
const [{ n: rows }] = db.prepare("SELECT COUNT(*) AS n FROM status_samples").all();
db.close();

console.log(
  `wrote ${rows.toLocaleString("en")} samples in ${((Date.now() - startedSeeding) / 1000).toFixed(1)}s ` +
    `(${(statSync(dbPath).size / 1024 / 1024).toFixed(1)}MB on disk)`,
);

const runtime = await buildUiRuntime({ dbPath, env: {}, logger: silent });
const server = runtime.app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];

const results = [];
for (const path of Object.keys(BUDGET_MS)) {
  const timings = [];
  let bytes = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const response = await fetch(`${base}${path}`);
    bytes = (await response.text()).length;
    timings.push(performance.now() - started);
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  }
  results.push({
    path,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
    kb: bytes / 1024,
    budget: BUDGET_MS[path],
  });
}

await new Promise((resolve) => server.close(resolve));
await runtime.close();
await rm(dir, { recursive: true, force: true });

console.log("");
console.log("endpoint                       p50       p95    payload   budget");
let failed = 0;
for (const result of results) {
  const over = result.p95 > result.budget;
  if (over) failed += 1;
  console.log(
    `${result.path.padEnd(28)} ${result.p50.toFixed(0).padStart(5)}ms ${result.p95
      .toFixed(0)
      .padStart(7)}ms ${result.kb.toFixed(0).padStart(8)}KB ${String(result.budget).padStart(7)}ms` +
      (over ? "  ← over budget" : ""),
  );
}

console.log("");
if (failed > 0) {
  console.error(
    `${failed} endpoint(s) over budget at ${PROVIDERS} providers × ${DAYS} days. ` +
      "Read this as an order-of-magnitude regression — a dropped index, or a query that started scanning.",
  );
  process.exit(1);
}
console.log(`all ${results.length} endpoints within budget at ${PROVIDERS} providers × ${DAYS} days.`);
