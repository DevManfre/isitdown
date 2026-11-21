#!/usr/bin/env node
// Resource envelope (roadmap 8.8): "will it run on my Raspberry Pi?", answered
// with numbers. Both editions run for real — the built `dist/` entry points,
// each in its own process — against 10, 100 and 500 providers served by a
// local fake Statuspage, and the script reads off what an operator sizes a
// machine by:
//
// - startup: process spawn until the first cycle is done (the UI's `/ready`
//   answering 200; the Light edition's first `triggerNow` returning);
// - resident memory (RSS) once at least a hundred cycles have run: RSS climbs
//   for the first couple of hundred cycles as V8 and the allocator reserve
//   memory, then levels off (the heap itself stays flat — measured, not a
//   leak), so a reading taken after five cycles undersells it by half;
// - CPU time per cycle, and how long a cycle takes — against a loopback
//   provider, so this is IsItDown's own cost: a real fleet adds the network's
//   round trips to the duration, not to the CPU;
// - the UI database right after startup: a provider added to the UI edition
//   gets its history backfilled from the page's own incident list (90 days of
//   samples), so a fleet starts with most of its size on day one;
// - database growth per provider per month (UI edition), extrapolated from
//   the bytes the cycles added at the default 3-minute interval. The default
//   retention (120 days) is longer than a month, so a month of growth is
//   linear; past the retention it levels off at about four months' worth.
//   The replay's whole readings are left out of it: they are capped at
//   READINGS_KEPT per provider (src/ui/sqliteStateStore.ts), a fixed cost
//   that stops growing after a hundred cycles, and counting them would make
//   a short run's growth look several times what a month's is.
//
// Nothing here reaches a real provider and nothing is left behind: the fake
// listens on loopback, every file lives in a temp directory removed at the end.
// Linux only (CPU and RSS come from /proc), like the images it sizes.
//
// Run it by hand, not in CI: it needs a fresh `npm run build:ui` (which builds
// the Light edition's files too) and takes about ten minutes. It prints the
// Markdown block that docs/docker.md §4.9 quotes, measuring conditions
// included.
//
// CLI: npm run measure:envelope [-- --sizes=10,100,500 --samples=2000]

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initialState, statuspageIncidents, statuspageSummary } from "./fake-provider.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The UI edition's default poll interval (src/ui/dbSettings.ts) — what "a month" is counted in. */
export const DEFAULT_INTERVAL_MINUTES = 3;
const CYCLES_PER_MONTH = (30 * 24 * 60) / DEFAULT_INTERVAL_MINUTES;
/** Fewest cycles measured at any size: enough for RSS to settle (see the header). */
const MIN_CYCLES = 100;

/**
 * Cycles to run for `providers`: enough that the database grows by at least
 * `samples` rows, so SQLite's page granularity (4 KiB) is noise, not signal.
 */
export function cyclesFor(providers, samples) {
  return Math.max(MIN_CYCLES, Math.ceil(samples / providers));
}

/** Database bytes one provider adds in a month at the default interval. */
export function monthlyGrowth(bytesAdded, providers, cycles) {
  return (bytesAdded / (providers * cycles)) * CYCLES_PER_MONTH;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const ms = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value.toFixed(0)} ms`);
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`);

/** One table row per edition and fleet size. */
export function render(rows, conditions) {
  return [
    `Measured on ${conditions.date}, IsItDown ${conditions.version}, Node ${conditions.node}, ${conditions.machine}.`,
    `Providers served by a local fake Statuspage (all operational), ${conditions.samples.toLocaleString("en")}+ samples per size;`,
    "growth extrapolated at the default 3-minute interval.",
    "",
    "| Edition | Providers | Startup to ready | Memory (RSS) | CPU per cycle | Cycle duration | Database after startup | Database per provider per month |",
    "|---|--:|--:|--:|--:|--:|--:|--:|",
    ...rows.map(
      (row) =>
        `| ${row.edition} | ${row.providers} | ${ms(row.startupMs)} | ${mb(row.rssBytes)} | ${ms(row.cpuMsPerCycle)} | ${ms(row.cycleMs)} | ${row.startBytes === null ? "—" : size(row.startBytes)} | ${row.monthlyBytes === null ? "— (state file)" : size(row.monthlyBytes)} |`,
    ),
  ].join("\n");
}

/** CPU time (user + system) and resident memory of a running process, from /proc. */
function processUsage(pid, clockTicks) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  // Fields after the parenthesised command name, which may itself hold spaces.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const cpuMs = ((Number(fields[11]) + Number(fields[12])) / clockTicks) * 1000;
  const rssKb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
  return { cpuMs, rssBytes: rssKb * 1024 };
}

/** A Statuspage at `/p/<n>` for every n, all operational, on a loopback port. */
async function startFakeFleet() {
  const state = initialState();
  const summary = JSON.stringify(statuspageSummary(state));
  const incidents = JSON.stringify(statuspageIncidents(state));
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    const body = url.endsWith("/api/v2/summary.json") ? summary : url.endsWith("/api/v2/incidents.json") ? incidents : null;
    res.writeHead(body === null ? 404 : 200, { "content-type": "application/json" });
    res.end(body ?? "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const services = (fleet, count) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Provider ${index}`, baseUrl: `${fleet.base}/p/${index}` }));

/** A child's stdout as a stream of JSON lines, one promise per line asked for. */
function lines(child) {
  let buffer = "";
  const waiting = [];
  const queued = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const next = waiting.shift();
      if (next) next(line);
      else queued.push(line);
      newline = buffer.indexOf("\n");
    }
  });
  return () => (queued.length > 0 ? Promise.resolve(queued.shift()) : new Promise((resolve) => waiting.push(resolve)));
}

/**
 * The Light edition has no HTTP surface to trigger a cycle through, so it runs
 * under a few lines that build the real runtime from dist/ and run a cycle per
 * line read on stdin — the same `triggerNow` the scheduler's timer calls.
 */
const LIGHT_DRIVER = `
import { createInterface } from "node:readline";
const { buildLightRuntime } = await import(process.env.RUNTIME_URL);
const { createLogger } = await import(process.env.LOGGER_URL);
const runtime = await buildLightRuntime({ configPath: process.env.CONFIG_PATH, dataPath: process.env.DATA_PATH, env: process.env, logger: createLogger("error", () => {}) });
const cycle = async () => { const result = await runtime.scheduler.triggerNow(); process.stdout.write(JSON.stringify({ ms: Date.parse(result.finishedAt) - Date.parse(result.startedAt), failed: result.results.filter((entry) => !entry.ok).length }) + "\\n"); };
await cycle();
for await (const line of createInterface({ input: process.stdin })) { if (line === "cycle") await cycle(); else break; }
await runtime.close();
`;

async function measureLight(fleet, providers, cycles, dir, clockTicks) {
  const configPath = join(dir, `light-${providers}.yml`);
  const dataPath = join(dir, `light-${providers}.json`);
  const config = { services: services(fleet, providers).map((service) => ({ ...service, adapter: "statuspage" })) };
  await writeFile(configPath, JSON.stringify(config));
  const started = performance.now();
  const child = spawn(process.execPath, ["--input-type=module", "-e", LIGHT_DRIVER], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      CONFIG_PATH: configPath,
      DATA_PATH: dataPath,
      LOG_LEVEL: "error",
      RUNTIME_URL: pathToFileURL(join(ROOT, "dist/light/runtime.js")).href,
      LOGGER_URL: pathToFileURL(join(ROOT, "dist/core/logger.js")).href,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const next = lines(child);
  const first = JSON.parse(await next());
  const startupMs = performance.now() - started;
  if (first.failed > 0) throw new Error(`light: ${first.failed} of ${providers} providers failed the first cycle`);

  const before = processUsage(child.pid, clockTicks);
  const durations = [];
  for (let run = 0; run < cycles; run += 1) {
    child.stdin.write("cycle\n");
    durations.push(JSON.parse(await next()).ms);
  }
  const after = processUsage(child.pid, clockTicks);
  child.stdin.end("stop\n");
  await new Promise((resolve) => child.once("exit", resolve));
  return {
    edition: "Light",
    providers,
    startupMs,
    rssBytes: after.rssBytes,
    cpuMsPerCycle: (after.cpuMs - before.cpuMs) / cycles,
    cycleMs: median(durations),
    startBytes: null,
    monthlyBytes: null,
  };
}

/**
 * Bytes of pages in use in the UI database, WAL included, free pages not —
 * all of them, and those outside the capped replay readings (see the header).
 */
function databaseBytes(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sum = (where) => Number(db.prepare(`SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat ${where}`).get().bytes);
    return { all: sum(""), growing: sum("WHERE name NOT LIKE 'status_readings%'") };
  } finally {
    db.close();
  }
}

async function measureUi(fleet, providers, cycles, dir, clockTicks) {
  const dbPath = join(dir, `ui-${providers}.db`);
  // Migrated by the real runtime rather than a copy of its schema that can
  // drift — the same move tools/loadtest.mjs makes.
  const { buildUiRuntime } = await import(pathToFileURL(join(ROOT, "dist/ui/runtime.js")).href);
  const { createLogger } = await import(pathToFileURL(join(ROOT, "dist/core/logger.js")).href);
  const migrating = await buildUiRuntime({ dbPath, env: {}, logger: createLogger("error", () => {}), seedProviders: false });
  await migrating.close();
  const db = new DatabaseSync(dbPath);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, NULL, 0, ?)",
  );
  db.exec("BEGIN");
  for (const service of services(fleet, providers)) insert.run(service.id, service.name, service.baseUrl, new Date().toISOString());
  db.exec("COMMIT");
  db.close();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const started = performance.now();
  const child = spawn(process.execPath, [join(ROOT, "dist/ui/server.js")], {
    cwd: ROOT,
    // The fake fleet is on loopback, which the UI edition's egress policy
    // refuses unless allowed (roadmap 9.1).
    env: { PATH: process.env.PATH, DB_PATH: dbPath, PORT: String(port), LOG_LEVEL: "error", EGRESS_ALLOW: "127.0.0.1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  for (;;) {
    const ready = await fetch(`${base}/ready`).then((response) => response.ok, () => false);
    if (ready) break;
    if (child.exitCode !== null) throw new Error(`ui: the server exited with code ${child.exitCode} before /ready`);
    if (performance.now() - started > 30 * 60_000) throw new Error("ui: /ready not 200 after thirty minutes");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const startupMs = performance.now() - started;

  const before = processUsage(child.pid, clockTicks);
  const bytesBefore = databaseBytes(dbPath);
  const durations = [];
  for (let run = 0; run < cycles; run += 1) {
    const result = await (await fetch(`${base}/poll`, { method: "POST" })).json();
    if (result.failed > 0) throw new Error(`ui: ${result.failed} of ${providers} providers failed a cycle`);
    durations.push(Date.parse(result.finishedAt) - Date.parse(result.startedAt));
  }
  const after = processUsage(child.pid, clockTicks);
  const bytesAdded = databaseBytes(dbPath).growing - bytesBefore.growing;
  child.kill("SIGTERM");
  await exited;
  return {
    edition: "UI",
    providers,
    startupMs,
    rssBytes: after.rssBytes,
    cpuMsPerCycle: (after.cpuMs - before.cpuMs) / cycles,
    cycleMs: median(durations),
    startBytes: bytesBefore.all,
    monthlyBytes: monthlyGrowth(bytesAdded, providers, cycles),
  };
}

if (process.argv[1]?.endsWith("envelope.mjs")) {
  const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const [key, value] = argument.replace(/^--/, "").split("=");
      return [key, value ?? "true"];
    }),
  );
  const sizes = (options["sizes"] ?? "10,100,500").split(",").map(Number);
  const samples = Number(options["samples"] ?? 2000);

  if (platform() !== "linux") {
    process.stderr.write("measure:envelope reads CPU and memory from /proc: run it on Linux (or in WSL)\n");
    process.exit(1);
  }
  for (const entry of ["dist/ui/server.js", "dist/ui/runtime.js", "dist/light/runtime.js"]) {
    if (!existsSync(join(ROOT, entry))) {
      process.stderr.write(`${entry} does not exist — run npm run build:ui first\n`);
      process.exit(1);
    }
  }

  const clockTicks = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
  const fleet = await startFakeFleet();
  const dir = await mkdtemp(join(tmpdir(), "isitdown-envelope-"));
  const rows = [];
  try {
    for (const providers of sizes) {
      const cycles = cyclesFor(providers, samples);
      process.stderr.write(`${providers} providers, ${cycles} cycles …\n`);
      rows.push(await measureLight(fleet, providers, cycles, dir, clockTicks));
      rows.push(await measureUi(fleet, providers, cycles, dir, clockTicks));
    }
  } finally {
    await fleet.close();
    await rm(dir, { recursive: true, force: true });
  }

  const conditions = {
    date: new Date().toISOString().slice(0, 10),
    version: `v${JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version}`,
    node: process.versions.node,
    machine: `${cpus()[0]?.model.trim() ?? "unknown CPU"} (${cpus().length} threads), ${(totalmem() / 1024 ** 3).toFixed(0)} GB RAM`,
    samples,
  };
  process.stdout.write(`${render(rows, conditions)}\n`);
}
