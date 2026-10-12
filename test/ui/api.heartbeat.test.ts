import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * The dead-man's switch — roadmap 2.5. What is worth holding: a job that stops
 * calling turns its provider into an outage through the ordinary cycle, and
 * the next call it makes resolves it at once — the ping is a trigger like the
 * provider push, never a second way the verdict is reached.
 */

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  request: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-heartbeat-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = createServer(runtime.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    request: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const BACKUP = {
  id: "nightly-backup",
  name: "Nightly backup",
  adapter: "heartbeat",
  baseUrl: "https://heartbeat.invalid",
  options: { every: "24h", grace: "1h" },
};

async function withBackup(env: NodeJS.ProcessEnv = { HEARTBEAT_TOKEN: "s3cret" }): Promise<Api> {
  const app = await api(env);
  const created = await app.request("POST", "/config/services", BACKUP);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return app;
}

/** Pretends the monitor started waiting, or last heard from the job, long ago. */
function backdate(app: Api, column: "armed_at" | "last_ping_at", iso: string): void {
  app.runtime.db
    .prepare(`INSERT INTO heartbeats (provider_id, armed_at) VALUES (?, ?) ON CONFLICT (provider_id) DO UPDATE SET ${column} = ?`)
    .run(BACKUP.id, iso, iso);
}

async function statusOf(app: Api): Promise<string | undefined> {
  const cycle = await app.runtime.scheduler.triggerFor(BACKUP.id);
  return cycle.results.find((result) => result.providerId === BACKUP.id)?.status?.overallStatus;
}

test("without HEARTBEAT_TOKEN the ping route does not exist", async () => {
  const app = await withBackup({});
  try {
    assert.equal((await app.request("GET", `/heartbeat/${BACKUP.id}?token=anything`)).status, 404);
    const listed = await app.request("GET", "/config/heartbeats");
    assert.equal(listed.body.enabled, false);
    assert.equal(listed.body.heartbeats[0].url, null);
  } finally {
    await app.close();
  }
});

test("a wrong or missing token is refused, and records nothing", async () => {
  const app = await withBackup();
  try {
    assert.equal((await app.request("GET", `/heartbeat/${BACKUP.id}`)).status, 401);
    assert.equal((await app.request("POST", `/heartbeat/${BACKUP.id}?token=wrong`)).status, 401);
    assert.equal(app.runtime.heartbeats.get(BACKUP.id)?.lastPingAt ?? null, null);
  } finally {
    await app.close();
  }
});

test("a ping for something that is not a heartbeat is a 404", async () => {
  const app = await withBackup();
  try {
    assert.equal((await app.request("GET", "/heartbeat/nobody?token=s3cret")).status, 404);
    const other = app.runtime.listAllServices().find((service) => service.adapter !== "heartbeat")!;
    assert.equal((await app.request("GET", `/heartbeat/${other.id}?token=s3cret`)).status, 404);
  } finally {
    await app.close();
  }
});

test("a job that stops calling becomes an outage, and its next call resolves it", async () => {
  const app = await withBackup();
  try {
    assert.equal(await statusOf(app), "operational", "a monitor armed just now is not late yet");

    backdate(app, "last_ping_at", "2026-01-01T00:00:00.000Z");
    assert.equal(await statusOf(app), "major_outage");

    const ping = await app.request("GET", `/heartbeat/${BACKUP.id}?token=s3cret`);
    assert.equal(ping.status, 200);
    assert.equal(ping.body.status, "polled");
    assert.equal(ping.body.changes, 1, "the recovery went through the diff engine");
    assert.equal(app.runtime.heartbeats.get(BACKUP.id)?.pings, 1);
  } finally {
    await app.close();
  }
});

test("a job that never called at all is late once its first period has run out", async () => {
  const app = await withBackup();
  try {
    backdate(app, "armed_at", "2026-01-01T00:00:00.000Z");
    assert.equal(await statusOf(app), "major_outage");
  } finally {
    await app.close();
  }
});

test("pings inside the cooldown are recorded without another read", async () => {
  const app = await withBackup();
  try {
    assert.equal((await app.request("POST", `/heartbeat/${BACKUP.id}?token=s3cret`)).body.status, "polled");
    const second = await app.request("POST", `/heartbeat/${BACKUP.id}?token=s3cret`);
    assert.equal(second.status, 202);
    assert.equal(app.runtime.heartbeats.get(BACKUP.id)?.pings, 2);
  } finally {
    await app.close();
  }
});

test("the dashboard is handed each heartbeat's URL and last call", async () => {
  const app = await withBackup();
  try {
    await app.request("GET", `/heartbeat/${BACKUP.id}?token=s3cret`);
    const listed = await app.request("GET", "/config/heartbeats");
    assert.equal(listed.body.enabled, true);
    assert.equal(listed.body.heartbeats.length, 1);
    const [entry] = listed.body.heartbeats;
    assert.equal(entry.providerId, BACKUP.id);
    assert.match(entry.url, /\/heartbeat\/nightly-backup\?token=s3cret$/);
    assert.equal(entry.pings, 1);
    assert.notEqual(entry.lastPingAt, null);
  } finally {
    await app.close();
  }
});

test("a heartbeat with options that cannot work is refused when saved", async () => {
  const app = await api();
  try {
    const refused = await app.request("POST", "/config/services", { ...BACKUP, options: { every: "24" } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /not a duration/);
  } finally {
    await app.close();
  }
});
