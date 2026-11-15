import { test } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import {
  insertService,
  listServices,
  purgeService,
} from "../../src/ui/dbServices.ts";
import { createLogger } from "../../src/core/logger.ts";
import { startFakeProvider } from "../../tools/fake-provider.mjs";

/**
 * Roadmap 13.4: the failures 10.4 says the database survives, done for real
 * rather than described. A process killed in the middle of writing, a page
 * torn on disk, a disk with no room left. Every scenario works in its own
 * temporary directory and removes it, and kills whatever it started.
 */

const SERVER = new URL("../../src/ui/server.ts", import.meta.url).pathname;

async function scratch(): Promise<{ dir: string; [Symbol.asyncDispose]: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-chaos-"));
  return { dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) };
}

/** A port free a moment ago: the server child needs one it can be told in advance. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The UI edition as the container runs it, on its own database and port. */
async function startServer(dbPath: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BIND_HOST: "127.0.0.1", LOG_LEVEL: "error" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${child.exitCode} before answering`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("the server never answered /health");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function stop(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill(signal);
  await exited;
}

test("a SIGKILL in the middle of a burst of writes loses nothing that was acknowledged", async () => {
  await using work = await scratch();
  const dbPath = join(work.dir, "isitdown.db");
  const port = await freePort();
  let server = await startServer(dbPath, port);
  try {
    // Every 201 is a committed transaction the client was told about. Eight
    // writers keep several in flight at the moment the process dies.
    let acknowledged = 0;
    let killed = false;
    const writer = async (): Promise<void> => {
      while (!killed) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/annotations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ at: new Date().toISOString(), label: `drill ${acknowledged}`, colour: "neutral" }),
          });
          if (response.status === 201) acknowledged += 1;
          await response.arrayBuffer();
        } catch {
          return; // The connection died with the process.
        }
      }
    };
    const writers = Array.from({ length: 8 }, writer);
    while (acknowledged < 300) await new Promise((resolve) => setTimeout(resolve, 5));
    killed = true;
    await stop(server, "SIGKILL");
    await Promise.all(writers);
    const promised = acknowledged;

    // The same file, started again: it opens, passes its check, and holds
    // every write it acknowledged — the last, unacknowledged ones may be gone.
    server = await startServer(dbPath, port);
    const { annotations } = (await (await fetch(`http://127.0.0.1:${port}/annotations?days=7`)).json()) as {
      annotations: unknown[];
    };
    assert.ok(
      annotations.length >= promised,
      `${annotations.length} markers survived, ${promised} were acknowledged`,
    );
  } finally {
    await stop(server, "SIGKILL");
  }
});

test("a torn page stops the start with a readable error and exit 1, and the file is left as it was", async () => {
  await using work = await scratch();
  const dbPath = join(work.dir, "isitdown.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE drill (id INTEGER PRIMARY KEY, body TEXT NOT NULL); BEGIN;");
  const insert = db.prepare("INSERT INTO drill (body) VALUES (?)");
  for (let i = 0; i < 2000; i++) insert.run(`row number ${i} `.repeat(4));
  db.exec("COMMIT");
  db.close();
  const fd = openSync(dbPath, "r+");
  writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 3 * 4096);
  closeSync(fd);
  const before = readFileSync(dbPath);

  const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [SERVER],
      { env: { ...process.env, DB_PATH: dbPath, PORT: "0", LOG_LEVEL: "error" }, timeout: 20_000 },
      (error, _stdout, stderr) => resolve({ code: error === null ? 0 : ((error as { code?: number }).code ?? null), stderr }),
    );
  });

  assert.equal(code, 1);
  // What happened, where, and what to do — in words, not a stack trace.
  assert.match(stderr, /database .* is damaged/);
  assert.ok(stderr.includes(dbPath), "names the file");
  assert.match(stderr, /Download database/, "points at the backup the dashboard downloads");
  assert.match(stderr, /\.recover/, "names the command that salvages what a backup lacks");
  assert.doesNotMatch(stderr, /^\s+at .+:\d+:\d+\)?$/m, "no stack trace");
  assert.deepEqual(readFileSync(dbPath), before);
});

test("a full disk fails the cycle cleanly, says so, and polling picks up again once there is room", async () => {
  await using work = await scratch();
  const lines: string[] = [];
  const fake = await startFakeProvider({ port: 0 });
  const runtime = await buildUiRuntime({
    dbPath: join(work.dir, "isitdown.db"),
    env: {},
    logger: createLogger("warn", (line) => lines.push(line)),
  });
  try {
    for (const service of listServices(runtime.db)) purgeService(runtime.db, service.id);
    for (let i = 0; i < 20; i++) {
      insertService(runtime.db, {
        id: `fake-${i}`,
        name: `Fake ${i}`,
        adapter: "statuspage",
        baseUrl: fake.baseUrls.statuspage,
        enabled: true,
        components: [],
      });
    }
    const baseline = await runtime.scheduler.triggerNow();
    assert.equal(baseline.results.filter((result) => !result.ok).length, 0);

    // The disk fills up: no page beyond the ones there are, and those packed.
    // SQLite's own page cap stands in for the device, with the same SQLITE_FULL
    // on the same code path — a real small filesystem needs root to mount.
    const { page_count: pages } = runtime.db.prepare("PRAGMA page_count").get() as { page_count: number };
    runtime.db.exec(`PRAGMA max_page_count = ${pages + 8}`);
    runtime.db.exec("CREATE TABLE ballast (b BLOB)");
    assert.throws(() => {
      for (;;) runtime.db.prepare("INSERT INTO ballast VALUES (randomblob(512))").run();
    }, /full/);
    // News worth writing down, more of it than any slack left in a page.
    fake.apply("incident-open", { name: "Elevated error rates ".repeat(200), impact: "critical", componentIds: ["api"] });

    const full = await runtime.scheduler.triggerNow();
    assert.equal(full.results.length, 20, "the cycle ran to its end");
    assert.equal(full.results.filter((result) => !result.ok).length, 20);
    // The operator is told the actual cause, in the log and on the probe the
    // container's healthcheck reads — not a crash, not a misleading rollback error.
    assert.ok(
      lines.some((line) => line.includes("database or disk is full")),
      "the log names the full disk",
    );
    assert.ok(!lines.some((line) => line.includes("cannot rollback")));
    const http = runtime.app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => http.once("listening", () => resolve()));
      const response = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/ready`);
      assert.equal(response.status, 503);
      assert.match(((await response.json()) as { reason: string }).reason, /every provider failed/);
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }

    // Room again: the next cycle writes what the full one could not.
    runtime.db.exec("PRAGMA max_page_count = 1073741823");
    const recovered = await runtime.scheduler.triggerNow();
    assert.equal(recovered.results.filter((result) => !result.ok).length, 0);
    const { n } = runtime.db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number };
    assert.equal(n, 20);
  } finally {
    await runtime.close();
    await fake.close();
  }
});
