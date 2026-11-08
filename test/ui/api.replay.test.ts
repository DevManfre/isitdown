import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { SentRecord } from "../../src/core/notificationDispatcher.ts";
import type { NormalizedStatus, OverallStatus } from "../../src/core/types.ts";
import type { ReplayResult } from "../../src/ui/replay.ts";
import type { DeliveryLogBody } from "./helpers/deliveryLog.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-replay-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const reading = (at: string, overallStatus: OverallStatus): NormalizedStatus => ({
  provider: "github",
  overallStatus,
  activeIncidents: [],
  components: [],
  maintenances: [],
  fetchedAt: at,
});

const sent = (over: Partial<SentRecord> = {}): SentRecord => ({
  providerId: "github",
  channel: "webhook",
  kind: "status_change",
  text: "🔴 GitHub is down",
  sentAt: "2026-11-01T10:06:05.000Z",
  ok: true,
  attempts: 1,
  ...over,
});

/** The id the delivery log gives the newest row — the one the dashboard would click. */
async function newestId(app: Api): Promise<number> {
  const log = (await app.get("/notifications/log")).body as DeliveryLogBody;
  const id = (log.page.items[0] as { id?: number } | undefined)?.id;
  assert.equal(typeof id, "number", "a delivery log row carries the id the replay is asked by");
  return id as number;
}

// Roadmap 5.12.
test("a delivery log row can be replayed: the readings that caused it, then the decisions that sent it", async () => {
  const app = await api();
  try {
    for (const [at, status] of [
      ["2026-11-01T10:00:00.000Z", "operational"],
      ["2026-11-01T10:03:00.000Z", "operational"],
      ["2026-11-01T10:06:00.000Z", "major_outage"],
    ] as const) {
      await app.runtime.store.saveStatus(reading(at, status));
    }
    await app.runtime.store.recordNotification(sent());

    const { status, body } = await app.get(`/notifications/${await newestId(app)}/replay`);
    const replayed = body as ReplayResult & { notification: { id: number; channel: string } };

    assert.equal(status, 200);
    assert.equal(replayed.reproduced, true);
    assert.equal(replayed.trigger?.fetchedAt, "2026-11-01T10:06:00.000Z");
    assert.equal(replayed.previous?.fetchedAt, "2026-11-01T10:03:00.000Z");
    assert.deepEqual(
      replayed.path.map((step) => step.step),
      ["diff", "damping", "routing", "channel", "quiet-hours", "cap"],
    );
    assert.equal(replayed.notification.channel, "webhook");
  } finally {
    await app.close();
  }
});

test("a row older than the saved readings says the readings are gone instead of guessing", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus(reading("2026-11-02T10:00:00.000Z", "operational"));
    await app.runtime.store.recordNotification(sent({ sentAt: "2026-10-01T10:00:00.000Z" }));

    const replayed = (await app.get(`/notifications/${await newestId(app)}/replay`)).body as ReplayResult;
    assert.equal(replayed.available, false);
    assert.equal(replayed.reproduced, false);
    assert.deepEqual(replayed.path, []);
  } finally {
    await app.close();
  }
});

test("a row nobody sent is a 404, not an empty replay", async () => {
  const app = await api();
  try {
    assert.equal((await app.get("/notifications/999999/replay")).status, 404);
    assert.equal((await app.get("/notifications/not-a-number/replay")).status, 400);
  } finally {
    await app.close();
  }
});

test("only the most recent readings are kept per provider, so the table cannot grow without bound", async () => {
  const app = await api();
  try {
    const base = Date.parse("2026-11-01T00:00:00.000Z");
    for (let index = 0; index < 130; index += 1) {
      await app.runtime.store.saveStatus(reading(new Date(base + index * 60_000).toISOString(), "operational"));
    }
    const kept = app.runtime.db
      .prepare("SELECT COUNT(*) AS n, MIN(observed_at) AS oldest FROM status_readings WHERE provider_id = 'github'")
      .get() as { n: number; oldest: string };

    assert.equal(kept.n, 100);
    assert.equal(kept.oldest, new Date(base + 30 * 60_000).toISOString(), "the oldest thirty were the ones dropped");
  } finally {
    await app.close();
  }
});
