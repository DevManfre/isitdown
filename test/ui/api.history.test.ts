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
import type { Incident, OverallStatus } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});
const DAY_MS = 24 * 3600 * 1000;

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-hist-api-"));
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

const at = (daysAgo: number, hour = 12): string =>
  new Date(new Date().setUTCHours(hour, 0, 0, 0) - daysAgo * DAY_MS).toISOString();

const save = (
  runtime: UiRuntime,
  provider: string,
  status: OverallStatus,
  when: string,
  incidents: Incident[] = [],
) =>
  runtime.store.saveStatus({
    provider,
    overallStatus: status,
    activeIncidents: incidents,
    components: [],
    fetchedAt: when,
  });

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: "i1",
  name: "Elevated error rates",
  impact: "major",
  status: "investigating",
  updatedAt: at(0, 10),
  ...over,
});

test("history returns a summary with one entry per provider and the requested window", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(1));
    const { status, body } = await app.get("/history?days=30");
    assert.equal(status, 200);
    const summary = body as {
      aggregateUptime: number;
      months: { month: string; uptime: number }[];
      providers: { providerId: string; buckets: unknown[] }[];
    };
    assert.equal(summary.providers.length, 3);
    assert.equal(summary.months.length, 4);
    assert.equal(summary.providers[0]?.buckets.length, 30);
  } finally {
    await app.close();
  }
});

test("history for one provider returns just that provider", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(0));
    const { status, body } = await app.get("/history?provider=github&days=7");
    assert.equal(status, 200);
    const single = body as { providerId: string; buckets: unknown[]; uptime7: number };
    assert.equal(single.providerId, "github");
    assert.equal(single.buckets.length, 7);
    assert.equal(single.uptime7, 100);
  } finally {
    await app.close();
  }
});

test("history only accepts the three documented windows", async () => {
  const app = await api();
  try {
    for (const days of ["7", "30", "90"]) {
      assert.equal((await app.get(`/history?days=${days}`)).status, 200, `days=${days}`);
    }
    for (const days of ["45", "0", "-7", "abc", "9999"]) {
      const { status, body } = await app.get(`/history?days=${days}`);
      assert.equal(status, 400, `days=${days}`);
      assert.match((body as { error: { message: string } }).error.message, /7|30|90/);
    }
  } finally {
    await app.close();
  }
});

test("history defaults to ninety days when no window is given", async () => {
  const app = await api();
  try {
    const { body } = await app.get("/history");
    assert.equal((body as { providers: { buckets: unknown[] }[] }).providers[0]?.buckets.length, 90);
  } finally {
    await app.close();
  }
});

test("history for an unknown provider is a 404", async () => {
  const app = await api();
  try {
    assert.equal((await app.get("/history?provider=nope")).status, 404);
  } finally {
    await app.close();
  }
});

test("component history returns one entry per selected component", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "github", { components: [{ id: "c1", name: "Actions" }] });
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [{ id: "c1", name: "Actions", status: "operational" }],
      fetchedAt: at(0),
    });

    const { status, body } = await app.get("/history/components?provider=github&days=7");
    assert.equal(status, 200);
    const payload = body as { components: { componentId: string; buckets: unknown[] }[] };
    assert.equal(payload.components.length, 1);
    assert.equal(payload.components[0]?.componentId, "c1");
    assert.equal(payload.components[0]?.buckets.length, 7);
  } finally {
    await app.close();
  }
});

test("component history 404s an unknown provider", async () => {
  const app = await api();
  try {
    const { status } = await app.get("/history/components?provider=nope&days=7");
    assert.equal(status, 404);
  } finally {
    await app.close();
  }
});

test("component history rejects a window it does not serve", async () => {
  const app = await api();
  try {
    const { status } = await app.get("/history/components?provider=github&days=13");
    assert.equal(status, 400);
  } finally {
    await app.close();
  }
});

/**
 * The shape the paged incident list reads. `active` stays alongside the page for
 * the view's hero card: that card shows the open incident whatever the filter
 * and whichever page the operator is on, so it cannot be carved out of the page.
 */
interface IncidentsPayload {
  active: { incidentId: string }[];
  page: { items: { incidentId: string }[]; page: number; pageSize: number; total: number };
  counts: { all: number; active: number; resolved: number };
}

/** `count` resolved incidents, newest first: r1 is the newest. */
const seedResolved = (app: Api, provider: string, count: number) =>
  app.runtime.store.applyBackfill(provider, {
    samples: [],
    incidents: Array.from({ length: count }, (_unused, index) => ({
      id: `r${index + 1}`,
      name: "Elevated error rates",
      impact: "minor",
      status: "resolved",
      startedAt: at(index + 2),
      resolvedAt: at(index + 2, 13),
      updatedAt: at(index + 2, 13),
    })),
  });

test("the incident list comes back as one page with the totals beside it", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "degraded", at(2), [incident({ id: "closed" })]);
    await save(app.runtime, "github", "degraded", at(1), [incident({ id: "open" })]);

    const { status, body } = await app.get("/incidents");
    assert.equal(status, 200);
    const payload = body as IncidentsPayload;

    assert.deepEqual(
      payload.active.map((row) => row.incidentId),
      ["open"],
    );
    // Newest first, open and resolved in one list — the pager is the same
    // control under every filter, so the unfiltered list holds both states.
    assert.deepEqual(
      payload.page.items.map((row) => row.incidentId),
      ["open", "closed"],
    );
    assert.equal(payload.page.page, 1);
    assert.equal(payload.page.pageSize, 20);
    assert.equal(payload.page.total, 2);
    assert.deepEqual(payload.counts, { all: 2, active: 1, resolved: 1 });
  } finally {
    await app.close();
  }
});

test("a later page returns the next slice, never a row the previous page held", async () => {
  const app = await api();
  try {
    await seedResolved(app, "github", 5);

    const first = ((await app.get("/incidents?pageSize=2&page=1")).body as IncidentsPayload).page;
    const second = ((await app.get("/incidents?pageSize=2&page=2")).body as IncidentsPayload).page;
    const third = ((await app.get("/incidents?pageSize=2&page=3")).body as IncidentsPayload).page;

    assert.deepEqual(first.items.map((row) => row.incidentId), ["r1", "r2"]);
    assert.deepEqual(second.items.map((row) => row.incidentId), ["r3", "r4"]);
    assert.deepEqual(third.items.map((row) => row.incidentId), ["r5"]);
    assert.equal(second.total, 5, "the total counts the whole list, not the page");
  } finally {
    await app.close();
  }
});

test("the page follows the state filter while the counts stay whole", async () => {
  const app = await api();
  try {
    await seedResolved(app, "github", 3);
    await save(app.runtime, "github", "degraded", at(0), [incident({ id: "open" })]);

    const resolved = (await app.get("/incidents?state=resolved&pageSize=2")).body as IncidentsPayload;
    const active = (await app.get("/incidents?state=active")).body as IncidentsPayload;

    assert.deepEqual(resolved.page.items.map((row) => row.incidentId), ["r1", "r2"]);
    assert.equal(resolved.page.total, 3, "a filtered total counts that state, not the page");
    assert.deepEqual(active.page.items.map((row) => row.incidentId), ["open"]);
    assert.equal(active.page.total, 1);
    // The filter pills show every state's count whichever one is selected.
    assert.deepEqual(resolved.counts, { all: 4, active: 1, resolved: 3 });
    assert.deepEqual(active.counts, resolved.counts);
  } finally {
    await app.close();
  }
});

test("a nonsense page, size or state falls back instead of failing the request", async () => {
  const app = await api();
  try {
    await seedResolved(app, "github", 3);

    for (const query of ["page=0", "page=-4", "page=abc", "state=sideways"]) {
      const { status, body } = await app.get(`/incidents?${query}`);
      assert.equal(status, 200, query);
      const payload = body as IncidentsPayload;
      assert.equal(payload.page.page, 1, query);
      assert.equal(payload.page.total, 3, query);
    }

    const huge = (await app.get("/incidents?pageSize=9999")).body as IncidentsPayload;
    assert.equal(huge.page.pageSize, 100, "an unbounded page size would defeat paging");
  } finally {
    await app.close();
  }
});

test("a page past the end is empty but still reports the total", async () => {
  const app = await api();
  try {
    await seedResolved(app, "github", 3);
    const { page } = (await app.get("/incidents?pageSize=2&page=9")).body as IncidentsPayload;
    assert.deepEqual(page.items, []);
    assert.equal(page.total, 3);
  } finally {
    await app.close();
  }
});

test("incidents can be filtered by provider", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "degraded", at(1), [incident({ id: "gh" })]);
    await save(app.runtime, "cloudflare", "degraded", at(1), [incident({ id: "cf" })]);

    const { body } = await app.get("/incidents?provider=cloudflare");
    const payload = body as IncidentsPayload;
    assert.deepEqual(
      payload.active.map((row) => row.incidentId),
      ["cf"],
    );
    // The page and the pill counts are scoped too — a provider-scoped list that
    // paged over every provider's rows would page past its own end.
    assert.deepEqual(
      payload.page.items.map((row) => row.incidentId),
      ["cf"],
    );
    assert.deepEqual(payload.counts, { all: 1, active: 1, resolved: 0 });
  } finally {
    await app.close();
  }
});

test("an incident detail carries the timeline, the action log and the recent polls", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(0, 8));
    await save(app.runtime, "github", "degraded", at(0, 9), [incident()]);
    await save(app.runtime, "github", "major_outage", at(0, 10), [
      incident({ status: "identified", updatedAt: at(0, 10) }),
    ]);
    await app.runtime.store.recordNotification({
      providerId: "github",
      channel: "telegram",
      kind: "incident_opened",
      text: "🔴 GitHub — MAJOR OUTAGE",
      sentAt: at(0, 10),
      ok: true,
    });

    const { status, body } = await app.get("/incidents/github/i1");
    assert.equal(status, 200);
    const detail = body as {
      incident: { incidentId: string; status: string };
      timeline: { at: string; label: string }[];
      actionLog: { channel: string; text: string }[];
      polls: { overallStatus: string }[];
      otherActiveIncidents: unknown[];
    };
    assert.equal(detail.incident.incidentId, "i1");
    assert.equal(detail.incident.status, "identified");
    assert.equal(detail.timeline[0]?.label, "opened");
    assert.ok(detail.timeline.length >= 2, "observed status transitions belong on the timeline");
    assert.equal(detail.actionLog.length, 1);
    assert.equal(detail.actionLog[0]?.channel, "telegram");
    assert.ok(detail.polls.length > 0 && detail.polls.length <= 24);
    assert.deepEqual(detail.otherActiveIncidents, []);
  } finally {
    await app.close();
  }
});

test("a resolved incident's detail ends with its resolution", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "degraded", at(0, 9), [incident()]);
    await save(app.runtime, "github", "operational", at(0, 11));

    const { body } = await app.get("/incidents/github/i1");
    const detail = body as { incident: { resolvedAt: string | null }; timeline: { label: string }[] };
    assert.ok(detail.incident.resolvedAt);
    assert.equal(detail.timeline.at(-1)?.label, "resolved");
  } finally {
    await app.close();
  }
});

test("an incident detail lists the provider's other open incidents", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "major_outage", at(0, 9), [
      incident({ id: "i1" }),
      incident({ id: "i2", name: "Search degraded" }),
    ]);
    const { body } = await app.get("/incidents/github/i1");
    const detail = body as { otherActiveIncidents: { incidentId: string }[] };
    assert.deepEqual(
      detail.otherActiveIncidents.map((row) => row.incidentId),
      ["i2"],
    );
  } finally {
    await app.close();
  }
});

test("an unknown incident is a 404", async () => {
  const app = await api();
  try {
    assert.equal((await app.get("/incidents/github/nope")).status, 404);
    assert.equal((await app.get("/incidents/nobody/i1")).status, 404);
  } finally {
    await app.close();
  }
});

test("the notification feed is newest first and capped", async () => {
  const app = await api();
  try {
    for (let i = 0; i < 5; i += 1) {
      await app.runtime.store.recordNotification({
        providerId: "github",
        channel: "telegram",
        kind: "status_change",
        text: `note ${i}`,
        sentAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
        ok: true,
      });
    }

    const all = (await app.get("/notifications")).body as { notifications: { text: string }[] };
    assert.equal(all.notifications[0]?.text, "note 4");

    const limited = (await app.get("/notifications?limit=2")).body as { notifications: unknown[] };
    assert.equal(limited.notifications.length, 2);

    const overCap = (await app.get("/notifications?limit=100000")).body as { notifications: unknown[] };
    assert.ok(overCap.notifications.length <= 200);
  } finally {
    await app.close();
  }
});

test("no response body anywhere leaks a value from the environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-leak-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { TELEGRAM_BOT_TOKEN: "123:SUPERSECRET", WEBHOOK_URL: "https://hooks.example/secret-path" },
    logger: silent,
  });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    for (const path of ["/status", "/health", "/history", "/incidents", "/notifications"]) {
      const text = await (await fetch(`http://127.0.0.1:${port}${path}`)).text();
      assert.ok(!text.includes("SUPERSECRET"), `${path} leaked a token`);
      assert.ok(!text.includes("secret-path"), `${path} leaked a URL`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});

test("an incident's action log shows only that provider's notifications", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "degraded", at(0, 9), [incident()]);
    for (const [providerId, text] of [
      ["github", "for github"],
      ["cloudflare", "for cloudflare"],
    ] as const) {
      await app.runtime.store.recordNotification({
        providerId,
        channel: "telegram",
        kind: "incident_opened",
        text,
        sentAt: at(0, 10),
        ok: true,
      });
    }

    const { body } = await app.get("/incidents/github/i1");
    const detail = body as { actionLog: { providerId: string; text: string }[] };
    assert.deepEqual(
      detail.actionLog.map((record) => record.text),
      ["for github"],
      "another provider's notifications must not appear in this incident's log",
    );
  } finally {
    await app.close();
  }
});
