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
  send: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
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
    send: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
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
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });
    await runtime.store.recordNotification({
      providerId: id,
      channel: "webhook",
      kind: "status_change",
      text: `${id} is down`,
      sentAt: new Date().toISOString(),
      ok: true,
      attempts: 1,
    });
  }
  return ids;
}

/**
 * One named incident per provider, so a search has something to tell apart
 * (roadmap 5.19). The names are deliberately different shapes: one plain, one
 * carrying a `%` so the pattern language's own wildcard is exercised.
 */
async function namedIncidents(runtime: UiRuntime): Promise<string[]> {
  const ids = runtime.listAllServices().map((service) => service.id);
  const names = ["Database connections exhausted", "API errors above 50% of requests", "Dashboard slow to load"];
  for (const [index, id] of ids.entries()) {
    await runtime.store.saveStatus({
      provider: id,
      overallStatus: "major_outage",
      activeIncidents: [incident(`${id}-1`, { name: names[index % names.length] as string })],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });
  }
  return ids;
}

interface IncidentsBody {
  active: { providerId: string }[];
  page: { items: { providerId: string; name: string }[]; total: number };
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

test("a search narrows the page and the counts, and leaves the active card alone", async () => {
  const app = await api();
  try {
    const ids = await namedIncidents(app.runtime);

    const { status, body } = await app.get("/incidents?q=database");
    assert.equal(status, 200);
    const payload = body as IncidentsBody;

    assert.deepEqual(
      payload.page.items.map((row) => row.name),
      ["Database connections exhausted"],
    );
    // The counts follow the search, or the pills would report the fleet's whole
    // history beside one matching row.
    assert.equal(payload.counts.all, 1);
    assert.equal(payload.page.total, 1);
    // The hero card is not part of the search: an operator typing must not
    // watch an open incident disappear.
    assert.equal(payload.active.length, ids.length);
  } finally {
    await app.close();
  }
});

test("a search matching nothing answers nothing rather than everything", async () => {
  const app = await api();
  try {
    await namedIncidents(app.runtime);

    const payload = (await app.get("/incidents?q=nothing-by-this-name")).body as IncidentsBody;
    assert.deepEqual(payload.page.items, []);
    assert.equal(payload.counts.all, 0);
  } finally {
    await app.close();
  }
});

test("the pattern language's own wildcards are searched for as text", async () => {
  const app = await api();
  try {
    await namedIncidents(app.runtime);

    // A bare `%` is "match everything" in a LIKE pattern; here it is a literal
    // the one incident that spells it out.
    const percent = (await app.get("/incidents?q=50%25%20of")).body as IncidentsBody;
    assert.deepEqual(
      percent.page.items.map((row) => row.name),
      ["API errors above 50% of requests"],
    );

    const underscore = (await app.get("/incidents?q=_")).body as IncidentsBody;
    assert.deepEqual(underscore.page.items, []);
  } finally {
    await app.close();
  }
});

test("the window leaves out an incident that started before it", async () => {
  const app = await api();
  try {
    const [id] = (await namedIncidents(app.runtime)) as [string, ...string[]];
    const longAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    await app.runtime.store.applyBackfill(id, {
      samples: [],
      incidents: [
        {
          id: `${id}-old`,
          name: "Database maintenance overran",
          impact: "minor",
          status: "resolved",
          startedAt: longAgo,
          resolvedAt: longAgo,
          updatedAt: longAgo,
        },
      ],
    });

    const everything = (await app.get("/incidents?q=database")).body as IncidentsBody;
    assert.equal(everything.counts.all, 2);

    const lastWeek = (await app.get("/incidents?q=database&days=7")).body as IncidentsBody;
    assert.deepEqual(
      lastWeek.page.items.map((row) => row.name),
      ["Database connections exhausted"],
    );
    assert.equal(lastWeek.counts.all, 1);
  } finally {
    await app.close();
  }
});

test("an unusable search or window shows the unfiltered list rather than an error", async () => {
  const app = await api();
  try {
    const ids = await namedIncidents(app.runtime);

    const blank = (await app.get("/incidents?q=%20%20&days=not-a-number")).body as IncidentsBody;
    assert.equal(blank.page.items.length, ids.length);
    assert.equal(blank.counts.all, ids.length);

    const tooLong = (await app.get(`/incidents?q=${"x".repeat(400)}`)).body as IncidentsBody;
    assert.equal(tooLong.counts.all, ids.length);
  } finally {
    await app.close();
  }
});

// Roadmap 5.3. The one account of an incident that nothing here can observe:
// why it mattered in this fleet.
test("a note written on an incident comes back with its detail, oldest first", async () => {
  const app = await api();
  try {
    const [providerId] = await openIncidents(app.runtime);
    const path = `/incidents/${providerId}/${providerId}-1/notes`;

    const first = await app.send("POST", path, { body: "Our deploy failed on this." });
    const second = await app.send("POST", path, { body: "Vendor confirmed at 14:10." });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const detail = (await app.get(`/incidents/${providerId}/${providerId}-1`)).body as {
      notes: { id: number; body: string; createdAt: string }[];
    };
    assert.deepEqual(
      detail.notes.map((note) => note.body),
      ["Our deploy failed on this.", "Vendor confirmed at 14:10."],
    );
  } finally {
    await app.close();
  }
});

test("a note is removed by the incident it was written on, and only by that one", async () => {
  const app = await api();
  try {
    const [providerId, otherId] = await openIncidents(app.runtime);
    const path = `/incidents/${providerId}/${providerId}-1/notes`;
    const created = (await app.send("POST", path, { body: "Worth keeping for a minute." })).body as {
      id: number;
    };

    // The same note id, addressed through a different incident: a mistake, not
    // a match.
    const wrong = await app.send("DELETE", `/incidents/${otherId}/${otherId}-1/notes/${created.id}`);
    assert.equal(wrong.status, 404);

    const removed = await app.send("DELETE", `${path}/${created.id}`);
    assert.equal(removed.status, 204);
    const detail = (await app.get(`/incidents/${providerId}/${providerId}-1`)).body as { notes: unknown[] };
    assert.deepEqual(detail.notes, []);
  } finally {
    await app.close();
  }
});

test("an empty note, an oversized one, and one about an unknown incident are all refused", async () => {
  const app = await api();
  try {
    const [providerId] = await openIncidents(app.runtime);
    const path = `/incidents/${providerId}/${providerId}-1/notes`;

    assert.equal((await app.send("POST", path, { body: "   " })).status, 400);
    assert.equal((await app.send("POST", path, { body: "x".repeat(2001) })).status, 400);
    // A typo in a url must not quietly accumulate notes about nothing.
    assert.equal(
      (await app.send("POST", `/incidents/${providerId}/nope/notes`, { body: "orphan" })).status,
      404,
    );
  } finally {
    await app.close();
  }
});
