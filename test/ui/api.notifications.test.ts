import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { updateService } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { SentRecord } from "../../src/core/notificationDispatcher.ts";
import type { DeliveryLogBody } from "./helpers/deliveryLog.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-log-api-"));
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

const sent = (over: Partial<SentRecord> = {}): SentRecord => ({
  providerId: "github",
  channel: "webhook",
  kind: "status_change",
  text: "🔴 GitHub is down\nWas: operational",
  sentAt: "2026-09-07T14:02:11.000Z",
  ok: true,
  attempts: 1,
  ...over,
});

async function record(runtime: UiRuntime, ...records: SentRecord[]): Promise<void> {
  for (const entry of records) await runtime.store.recordNotification(entry);
}

test("the delivery log answers with a page and every outcome's count", async () => {
  const app = await api();
  try {
    await record(
      app.runtime,
      sent(),
      sent({ channel: "telegram", ok: false, error: "401 Unauthorized" }),
      sent({ channel: "telegram", sentAt: "2026-09-07T13:00:00.000Z" }),
    );

    const { status, body } = await app.get("/notifications/log");
    const log = body as DeliveryLogBody;

    assert.equal(status, 200);
    assert.deepEqual(log.counts, { all: 3, sent: 2, failed: 1 });
    assert.equal(log.page.items.length, 3);
    // Newest first, the way the feed is.
    assert.equal(log.page.items[0]?.sentAt, "2026-09-07T14:02:11.000Z");
  } finally {
    await app.close();
  }
});

test("the failed slice carries the provider's own error, which nothing else exposed", async () => {
  const app = await api();
  try {
    await record(app.runtime, sent(), sent({ channel: "telegram", ok: false, error: "401 Unauthorized" }));

    const { body } = await app.get("/notifications/log?state=failed");
    const log = body as DeliveryLogBody;

    assert.equal(log.page.items.length, 1);
    assert.equal(log.page.items[0]?.error, "401 Unauthorized");
    // The total follows the filter; the counts do not.
    assert.equal(log.page.total, 1);
    assert.equal(log.counts.all, 2);
  } finally {
    await app.close();
  }
});

test("a channel filter narrows the page and the counts together", async () => {
  const app = await api();
  try {
    await record(app.runtime, sent(), sent({ channel: "telegram", ok: false, error: "boom" }));

    const { body } = await app.get("/notifications/log?channel=telegram");
    const log = body as DeliveryLogBody;

    assert.equal(log.page.items.length, 1);
    assert.deepEqual(log.counts, { all: 1, sent: 0, failed: 1 });
  } finally {
    await app.close();
  }
});

test("paging is server-side, and the total is the whole filtered log", async () => {
  const app = await api();
  try {
    for (let index = 0; index < 5; index += 1) {
      await record(app.runtime, sent({ sentAt: `2026-09-07T14:0${index}:00.000Z` }));
    }

    const first = (await app.get("/notifications/log?pageSize=2")).body as DeliveryLogBody;
    const second = (await app.get("/notifications/log?pageSize=2&page=2")).body as DeliveryLogBody;

    assert.equal(first.page.items.length, 2);
    assert.equal(first.page.total, 5);
    assert.equal(second.page.page, 2);
    assert.notEqual(first.page.items[0]?.sentAt, second.page.items[0]?.sentAt);
  } finally {
    await app.close();
  }
});

test("a nonsense page or state falls back rather than failing the whole log", async () => {
  const app = await api();
  try {
    await record(app.runtime, sent());

    const { status, body } = await app.get("/notifications/log?page=-3&pageSize=nope&state=wobble");
    const log = body as DeliveryLogBody;

    assert.equal(status, 200);
    assert.equal(log.page.page, 1);
    assert.equal(log.page.items.length, 1);
  } finally {
    await app.close();
  }
});

test("a disabled provider's sends leave the log, page and counts alike", async () => {
  const app = await api();
  try {
    const [first, second] = app.runtime.listAllServices().map((service) => service.id);
    await record(app.runtime, sent({ providerId: first! }), sent({ providerId: second! }));

    updateService(app.runtime.db, second!, { enabled: false });

    const log = (await app.get("/notifications/log")).body as DeliveryLogBody;

    assert.equal(log.counts.all, 1);
    assert.deepEqual(
      log.page.items.map((item) => item.providerId),
      [first],
    );
  } finally {
    await app.close();
  }
});

test("a dead letter reaches the log with the attempts it cost", async () => {
  // What roadmap 3.14 exists for: the delivery log has to say that a send was
  // retried and still lost, not merely that it failed.
  const app = await api();
  try {
    await record(
      app.runtime,
      sent({ ok: false, error: "401 Unauthorized", attempts: 3 }),
      sent({ channel: "telegram", attempts: 2 }),
    );

    const log = (await app.get("/notifications/log?state=all")).body as DeliveryLogBody;
    const dead = log.page.items.find((item) => !item.ok);
    const recovered = log.page.items.find((item) => item.ok);

    assert.equal(dead?.attempts, 3);
    assert.equal(dead?.error, "401 Unauthorized");
    assert.equal(recovered?.attempts, 2, "a send that took two tries still reports two");
  } finally {
    await app.close();
  }
});
