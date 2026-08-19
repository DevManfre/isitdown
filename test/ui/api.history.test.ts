import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
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

test("incidents are split into active and closed", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "degraded", at(2), [incident({ id: "closed" })]);
    await save(app.runtime, "github", "degraded", at(1), [incident({ id: "open" })]);

    const { status, body } = await app.get("/incidents");
    assert.equal(status, 200);
    const payload = body as { active: { incidentId: string }[]; closed: { incidentId: string }[] };
    assert.deepEqual(
      payload.active.map((row) => row.incidentId),
      ["open"],
    );
    assert.deepEqual(
      payload.closed.map((row) => row.incidentId),
      ["closed"],
    );
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
    const payload = body as { active: { incidentId: string }[] };
    assert.deepEqual(
      payload.active.map((row) => row.incidentId),
      ["cf"],
    );
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
