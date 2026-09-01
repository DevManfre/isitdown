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
import type { Incident } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-inc-api-"));
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

const incident = (id: string, over: Partial<Incident> = {}): Incident => ({
  id,
  name: "Elevated error rates",
  impact: "major",
  status: "investigating",
  updatedAt: new Date().toISOString(),
  ...over,
});

/** An incident on every seeded provider, so disabling one must remove exactly one. */
async function openIncidents(runtime: UiRuntime): Promise<string[]> {
  const ids = runtime.listAllServices().map((service) => service.id);
  for (const id of ids) {
    await runtime.store.saveStatus({
      provider: id,
      overallStatus: "major_outage",
      activeIncidents: [incident(`${id}-1`)],
      components: [],
      fetchedAt: new Date().toISOString(),
    });
    await runtime.store.recordNotification({
      providerId: id,
      channel: "webhook",
      kind: "status_change",
      text: `${id} is down`,
      sentAt: new Date().toISOString(),
      ok: true,
    });
  }
  return ids;
}

interface IncidentsBody {
  active: { providerId: string }[];
  page: { items: { providerId: string }[]; total: number };
  counts: { all: number; active: number; resolved: number };
}

test("incidents leave out a disabled provider, in the page, the counts and the active list", async () => {
  const app = await api();
  try {
    const ids = await openIncidents(app.runtime);
    const [off] = ids;
    updateService(app.runtime.db, off as string, { enabled: false });

    const { status, body } = await app.get("/incidents");
    assert.equal(status, 200);
    const payload = body as IncidentsBody;
    assert.deepEqual(
      payload.page.items.filter((row) => row.providerId === off),
      [],
    );
    assert.deepEqual(
      payload.active.filter((row) => row.providerId === off),
      [],
    );
    assert.equal(payload.page.total, ids.length - 1);
    assert.equal(payload.counts.all, ids.length - 1);
    assert.equal(payload.counts.active, ids.length - 1);
  } finally {
    await app.close();
  }
});

test("incidents are empty rather than unfiltered when every provider is disabled", async () => {
  const app = await api();
  try {
    const ids = await openIncidents(app.runtime);
    for (const id of ids) updateService(app.runtime.db, id, { enabled: false });

    const { status, body } = await app.get("/incidents");
    assert.equal(status, 200);
    const payload = body as IncidentsBody;
    assert.deepEqual(payload.page.items, []);
    assert.deepEqual(payload.active, []);
    assert.equal(payload.counts.all, 0);
  } finally {
    await app.close();
  }
});

test("an explicit provider filter still answers for that provider only when it is enabled", async () => {
  const app = await api();
  try {
    const ids = await openIncidents(app.runtime);
    const [off, on] = ids;
    updateService(app.runtime.db, off as string, { enabled: false });

    const disabled = (await app.get(`/incidents?provider=${off as string}`)).body as IncidentsBody;
    assert.deepEqual(disabled.page.items, []);
    assert.equal(disabled.counts.all, 0);

    const enabled = (await app.get(`/incidents?provider=${on as string}`)).body as IncidentsBody;
    assert.equal(enabled.page.items.length, 1);
  } finally {
    await app.close();
  }
});

test("the notification feed leaves out a disabled provider", async () => {
  const app = await api();
  try {
    const ids = await openIncidents(app.runtime);
    const [off] = ids;
    updateService(app.runtime.db, off as string, { enabled: false });

    const { status, body } = await app.get("/notifications");
    assert.equal(status, 200);
    const payload = body as { notifications: { providerId: string }[] };
    assert.equal(payload.notifications.length, ids.length - 1);
    assert.deepEqual(
      payload.notifications.filter((record) => record.providerId === off),
      [],
    );
  } finally {
    await app.close();
  }
});
