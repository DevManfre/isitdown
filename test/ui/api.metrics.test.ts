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

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; contentType: string | null; body: string }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-metrics-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** The value of one sample line, or undefined when the series is absent. */
function sample(body: string, series: string): string | undefined {
  const line = body.split("\n").find((entry) => entry.startsWith(`${series} `));
  return line?.slice(series.length + 1);
}

test("metrics are served as Prometheus text with a typed, documented series", async () => {
  const app = await api();
  try {
    const { status, contentType, body } = await app.get("/metrics");

    assert.equal(status, 200);
    assert.match(contentType ?? "", /^text\/plain/);
    assert.match(body, /^# HELP isitdown_provider_up .+$/m);
    assert.match(body, /^# TYPE isitdown_provider_up gauge$/m);
    assert.equal(body.endsWith("\n"), true, "the exposition format ends with a newline");
  } finally {
    await app.close();
  }
});

test("a provider that has never been polled is reported down, not absent", async () => {
  const app = await api();
  try {
    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_provider_up{provider="github",name="GitHub"}'), "0");
    assert.equal(sample(body, 'isitdown_provider_status{provider="github",status="unknown"}'), "1");
    assert.equal(sample(body, 'isitdown_provider_status{provider="github",status="operational"}'), "0");
    assert.equal(sample(body, "isitdown_providers_total"), "3");
  } finally {
    await app.close();
  }
});

test("stored state drives the provider gauges", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "major_outage",
      activeIncidents: [
        { id: "i1", name: "Down", impact: "critical", status: "investigating", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      components: [],
      maintenances: [],
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_provider_up{provider="github",name="GitHub"}'), "0");
    assert.equal(sample(body, 'isitdown_provider_status{provider="github",status="major_outage"}'), "1");
    assert.equal(sample(body, 'isitdown_provider_active_incidents{provider="github"}'), "1");
    assert.equal(
      sample(body, 'isitdown_provider_last_fetch_timestamp_seconds{provider="github"}'),
      String(Date.parse("2026-01-01T00:00:00.000Z") / 1000),
    );
  } finally {
    await app.close();
  }
});

test("an operational provider is up", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_provider_up{provider="github",name="GitHub"}'), "1");
  } finally {
    await app.close();
  }
});

test("a disabled provider is not scraped as if it were watched", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "cloudflare", { enabled: false });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_provider_up{provider="cloudflare",name="Cloudflare"}'), undefined);
    assert.equal(sample(body, "isitdown_providers_total"), "2");
  } finally {
    await app.close();
  }
});

test("the last cycle's timing and outcome are exposed per provider", async () => {
  const app = await api();
  try {
    app.runtime.metrics.recordCycle({
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      changes: [],
      results: [
        { providerId: "github", ok: true, attempts: 1, durationMs: 412 },
        { providerId: "cloudflare", ok: false, attempts: 3, durationMs: 8000, error: "timeout" },
      ],
    });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_poll_duration_seconds{provider="github"}'), "0.412");
    assert.equal(sample(body, 'isitdown_poll_duration_seconds{provider="cloudflare"}'), "8");
    assert.equal(sample(body, 'isitdown_polls_total{provider="github",outcome="success"}'), "1");
    assert.equal(sample(body, 'isitdown_polls_total{provider="github",outcome="failure"}'), "0");
    assert.equal(sample(body, 'isitdown_polls_total{provider="cloudflare",outcome="failure"}'), "1");
    assert.equal(
      sample(body, "isitdown_last_cycle_timestamp_seconds"),
      String(Date.parse("2026-01-01T00:00:02.000Z") / 1000),
    );
  } finally {
    await app.close();
  }
});

test("poll counters accumulate across cycles instead of reporting the last one", async () => {
  const app = await api();
  try {
    const cycle = {
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      changes: [],
      results: [{ providerId: "github", ok: true, attempts: 1, durationMs: 100 }],
    };
    app.runtime.metrics.recordCycle(cycle);
    app.runtime.metrics.recordCycle(cycle);

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_polls_total{provider="github",outcome="success"}'), "2");
  } finally {
    await app.close();
  }
});

test("notifications are counted per channel and outcome", async () => {
  const app = await api();
  try {
    app.runtime.metrics.recordSent({
      providerId: "github",
      channel: "telegram",
      kind: "status_change",
      text: "x",
      sentAt: "2026-01-01T00:00:00.000Z",
      ok: true,
    });
    app.runtime.metrics.recordSent({
      providerId: "github",
      channel: "telegram",
      kind: "status_change",
      text: "x",
      sentAt: "2026-01-01T00:00:01.000Z",
      ok: false,
      error: "401",
    });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_notifications_total{channel="telegram",outcome="sent"}'), "1");
    assert.equal(sample(body, 'isitdown_notifications_total{channel="telegram",outcome="failed"}'), "1");
  } finally {
    await app.close();
  }
});

test("a provider name carrying quotes or backslashes cannot break the label syntax", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "github", { name: 'Git"hub\\prod' });

    const { body } = await app.get("/metrics");

    assert.equal(sample(body, 'isitdown_provider_up{provider="github",name="Git\\"hub\\\\prod"}'), "0");
  } finally {
    await app.close();
  }
});
