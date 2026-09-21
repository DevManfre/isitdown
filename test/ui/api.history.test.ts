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
  post: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  del: (path: string) => Promise<{ status: number; body: unknown }>;
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
    post: async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    del: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "DELETE" });
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
    maintenances: [],
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

test("the year calendar returns 365 day cells for one provider", async () => {
  // Roadmap 5.20. A fixed window, so the answer names it rather than echoing a
  // parameter the route does not take.
  const app = await api();
  try {
    await save(app.runtime, "github", "major_outage", at(200));
    await save(app.runtime, "github", "operational", at(0));

    const { status, body } = await app.get("/history/calendar?provider=github");
    assert.equal(status, 200);
    const calendar = body as {
      providerId: string;
      days: number;
      measuredDays: number;
      cells: { day: string; status: string; uptime: number | null }[];
    };
    assert.equal(calendar.providerId, "github");
    assert.equal(calendar.days, 365);
    assert.equal(calendar.cells.length, 365);
    assert.equal(calendar.measuredDays, 2);
    assert.equal(calendar.cells.at(-1)?.status, "operational");
    assert.equal(calendar.cells[0]?.uptime, null, "an unsampled day has no percentage");
  } finally {
    await app.close();
  }
});

test("the year calendar needs a provider, and 404s one it does not know", async () => {
  const app = await api();
  try {
    const missing = await app.get("/history/calendar");
    assert.equal(missing.status, 400);
    const unknown = await app.get("/history/calendar?provider=nope");
    assert.equal(unknown.status, 404);
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
      maintenances: [],
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
      attempts: 1,
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
        attempts: 1,
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
        attempts: 1,
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

test("history carries the trend series the dashboard charts", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(0));
    const { status, body } = await app.get("/history?days=7");
    const summary = body as {
      dailyUptime: { day: string; uptime: number | null }[];
      aggregateDelta: number | null;
    };
    assert.equal(status, 200);
    assert.equal(summary.dailyUptime.length, 7, "one entry per day in the window");
    assert.equal(summary.dailyUptime.at(-1)?.uptime, 100, "today was sampled, and github was up");
    assert.equal(summary.aggregateDelta, null, "nothing was sampled in the week before, so no comparison exists");
  } finally {
    await app.close();
  }
});

test("the history summary leaves out a disabled provider", async () => {
  const app = await api();
  try {
    for (const service of app.runtime.listAllServices()) {
      await save(app.runtime, service.id, "operational", at(1));
    }
    const all = ((await app.get("/history?days=30")).body as { providers: unknown[] }).providers.length;

    const [off] = app.runtime.listAllServices();
    updateService(app.runtime.db, (off as { id: string }).id, { enabled: false });

    const { status, body } = await app.get("/history?days=30");
    assert.equal(status, 200);
    const summary = body as { providers: { providerId: string }[] };
    assert.equal(summary.providers.length, all - 1);
    assert.deepEqual(
      summary.providers.filter((provider) => provider.providerId === (off as { id: string }).id),
      [],
    );
  } finally {
    await app.close();
  }
});

test("an arbitrary range answers the same shape, spanning exactly the days asked for", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(5));
    await save(app.runtime, "github", "major_outage", at(4));
    const from = at(5).slice(0, 10);
    const to = at(3).slice(0, 10);

    const { status, body } = await app.get(`/history?provider=github&from=${from}&to=${to}`);
    assert.equal(status, 200);
    const single = body as { providerId: string; buckets: { day: string }[] };
    assert.equal(single.providerId, "github");
    assert.equal(single.buckets.length, 3, "both ends are included");
    assert.equal(single.buckets[0]?.day, from);
    assert.equal(single.buckets.at(-1)?.day, to);
  } finally {
    await app.close();
  }
});

test("a range that ended in the past still reads the samples inside it", async () => {
  const app = await api();
  try {
    // Two days of samples well behind today, and nothing since.
    await save(app.runtime, "github", "operational", at(40));
    await save(app.runtime, "github", "major_outage", at(39));

    const { body } = await app.get(
      `/history?provider=github&from=${at(41).slice(0, 10)}&to=${at(38).slice(0, 10)}`,
    );
    const single = body as { sampleCount: number; buckets: { day: string; status: string }[] };
    assert.equal(single.sampleCount, 2, "a window ending in the past is not empty");
  } finally {
    await app.close();
  }
});

test("the fleet summary takes a range too", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(2));
    const { status, body } = await app.get(
      `/history?from=${at(2).slice(0, 10)}&to=${at(0).slice(0, 10)}`,
    );
    assert.equal(status, 200);
    const summary = body as { providers: { buckets: unknown[] }[] };
    assert.equal(summary.providers[0]?.buckets.length, 3);
  } finally {
    await app.close();
  }
});

test("a half-written or impossible range is refused in words", async () => {
  const app = await api();
  try {
    for (const [query, expected] of [
      ["from=2026-01-01", /together/],
      ["to=2026-01-01", /together/],
      ["from=january&to=2026-01-02", /YYYY-MM-DD/],
      ["from=2026-01-05&to=2026-01-01", /before/],
      ["from=2020-01-01&to=2026-01-01", /at most/],
    ] as const) {
      const { status, body } = await app.get(`/history?${query}`);
      assert.equal(status, 400, query);
      assert.match((body as { error: { message: string } }).error.message, expected, query);
    }
  } finally {
    await app.close();
  }
});

test("history reports how much of the window the poller was actually running", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational", at(1));

    // Nothing recorded yet: the window says "we cannot tell" rather than 0, so
    // an install upgrading into this trace does not have its past redrawn as an
    // outage of ours.
    const before = (await app.get("/history?days=7")).body as { coverage: number | null };
    assert.equal(before.coverage, null);

    // Two cycles a minute apart on a three-minute cadence, then silence: today
    // is covered for that minute and missing for the rest.
    await app.runtime.store.recordPollCycle({
      startedAt: at(0, 0),
      finishedAt: at(0, 0),
      intervalMinutes: 3,
      providers: 1,
    });
    await app.runtime.store.recordPollCycle({
      startedAt: at(0, 1),
      finishedAt: at(0, 1),
      intervalMinutes: 3,
      providers: 1,
    });

    const { body } = await app.get("/history?days=7");
    const summary = body as {
      coverage: number | null;
      dailyCoverage: { day: string; observed: number | null }[];
      providers: { coverage: number | null; dailyCoverage: unknown[] }[];
    };
    assert.equal(summary.dailyCoverage.length, 7, "one entry per day shown, gap-filled");
    // Only today has evidence; the six days before the first cycle stay unjudged.
    assert.deepEqual(
      summary.dailyCoverage.slice(0, 6).map((entry) => entry.observed),
      [null, null, null, null, null, null],
    );
    const today = summary.dailyCoverage.at(-1);
    assert.ok(today !== undefined && today.observed !== null && today.observed < 1, String(today?.observed));
    // The same caveat travels on every provider, because the gap is the
    // poller's and not any one provider's.
    assert.equal(summary.providers[0]?.dailyCoverage.length, 7);
    assert.equal(summary.providers[0]?.coverage, summary.coverage);
  } finally {
    await app.close();
  }
});

test("an annotation is written, read back inside its window, and removed", async () => {
  const app = await api();
  try {
    const created = await app.post("/annotations", {
      at: at(1, 0),
      label: "v2.4.0 shipped",
      colour: "accent",
    });
    assert.equal(created.status, 201);
    const marker = created.body as { id: number; providerId: string | null; colour: string };
    assert.equal(marker.providerId, null, "no provider means the whole fleet");

    const listed = (await app.get("/annotations?days=7")).body as { annotations: { label: string }[] };
    assert.deepEqual(
      listed.annotations.map((entry) => entry.label),
      ["v2.4.0 shipped"],
    );

    // A window that ends before it does not show it.
    const older = (await app.get("/annotations?from=2020-01-01&to=2020-01-07")).body as {
      annotations: unknown[];
    };
    assert.deepEqual(older.annotations, []);

    assert.equal((await app.del(`/annotations/${marker.id}`)).status, 204);
    assert.equal((await app.del(`/annotations/${marker.id}`)).status, 404, "a stale id is not a silent no-op");
  } finally {
    await app.close();
  }
});

test("a provider's markers include the fleet-wide ones, and a bad colour is refused", async () => {
  const app = await api();
  try {
    await app.post("/annotations", { at: at(1, 0), label: "fleet deploy", colour: "accent" });
    await app.post("/annotations", { at: at(1, 0), label: "github config", colour: "warn", providerId: "github" });

    const scoped = (await app.get("/annotations?days=7&provider=github")).body as {
      annotations: { label: string }[];
    };
    // Both: a deploy that broke GitHub's page is exactly the marker wanted here.
    assert.deepEqual(
      scoped.annotations.map((entry) => entry.label).sort(),
      ["fleet deploy", "github config"],
    );

    assert.equal((await app.post("/annotations", { at: at(0, 0), label: "x", colour: "#ff0000" })).status, 400);
    assert.equal(
      (await app.post("/annotations", { at: at(0, 0), label: "x", colour: "accent", providerId: "nope" })).status,
      404,
    );
  } finally {
    await app.close();
  }
});
