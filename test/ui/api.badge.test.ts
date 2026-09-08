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
import type { NormalizedStatus, OverallStatus } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; contentType: string | null; cacheControl: string | null; body: string }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-badge-"));
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
        cacheControl: response.headers.get("cache-control"),
        body: await response.text(),
      };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const reading = (provider: string, overallStatus: OverallStatus, incidents = 0): NormalizedStatus => ({
  provider,
  overallStatus,
  activeIncidents: Array.from({ length: incidents }, (_unused, index) => ({
    id: `i${index}`,
    name: "Something broke",
    impact: "major",
    status: "investigating",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
  components: [],
  maintenances: [],
  fetchedAt: "2026-01-01T00:00:00.000Z",
});

test("a provider badge is an SVG saying what the provider's last reading was", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus(reading("github", "operational"));

    const { status, contentType, cacheControl, body } = await app.get("/badge/github.svg");

    assert.equal(status, 200);
    assert.match(contentType ?? "", /image\/svg\+xml/);
    // Cached briefly: a README badge is fetched by every visitor through a
    // proxy, and an hour-stale badge is worse than a slightly chatty one.
    assert.match(cacheControl ?? "", /max-age=60/);
    assert.match(body, /^<svg /);
    assert.match(body, /GitHub/);
    assert.match(body, /operational/);
  } finally {
    await app.close();
  }
});

test("a badge for a provider that has never been polled says unknown, not operational", async () => {
  const app = await api();
  try {
    const { body } = await app.get("/badge/github.svg");

    assert.match(body, /unknown/);
    assert.doesNotMatch(body, />operational</);
  } finally {
    await app.close();
  }
});

test("the fleet badge reports the worst reading anything is showing", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus(reading("github", "operational"));
    await app.runtime.store.saveStatus(reading("cloudflare", "degraded"));
    await app.runtime.store.saveStatus(reading("anthropic", "major_outage"));

    assert.match((await app.get("/badge.svg")).body, /major outage/);
  } finally {
    await app.close();
  }
});

test("a disabled provider does not decide the fleet badge", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus(reading("github", "operational"));
    await app.runtime.store.saveStatus(reading("cloudflare", "operational"));
    await app.runtime.store.saveStatus(reading("anthropic", "major_outage"));
    updateService(app.runtime.db, "anthropic", { enabled: false });

    assert.match((await app.get("/badge.svg")).body, />operational</);
  } finally {
    await app.close();
  }
});

test("an unknown provider answers 404 with a badge rather than JSON", async () => {
  const app = await api();
  try {
    const { status, contentType, body } = await app.get("/badge/nope.svg");

    assert.equal(status, 404);
    assert.match(contentType ?? "", /image\/svg\+xml/);
    assert.match(body, /unknown/);
  } finally {
    await app.close();
  }
});

test("a provider name with markup in it cannot break out of the badge", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "github", { name: '<script>alert("x")</script>' });

    const { body } = await app.get("/badge/github.svg");

    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /&lt;script&gt;/);
  } finally {
    await app.close();
  }
});

test("the widget summary counts the fleet in the shape a home page draws", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus(reading("github", "operational"));
    await app.runtime.store.saveStatus(reading("cloudflare", "degraded"));
    await app.runtime.store.saveStatus(reading("anthropic", "major_outage", 2));
    updateService(app.runtime.db, "cloudflare", {
      mutedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const { status, body } = await app.get("/widget");
    const summary = JSON.parse(body) as Record<string, unknown>;

    assert.equal(status, 200);
    assert.equal(summary["status"], "major_outage");
    assert.equal(summary["providers"], 3);
    assert.equal(summary["operational"], 1);
    assert.equal(summary["degraded"], 1);
    assert.equal(summary["down"], 1);
    assert.equal(summary["incidents"], 2);
    assert.equal(summary["muted"], 1);
    assert.equal(summary["retentionDays"], 120);
  } finally {
    await app.close();
  }
});

test("a fleet nothing has polled yet reports unknown rather than an empty summary", async () => {
  const app = await api();
  try {
    const summary = JSON.parse((await app.get("/widget")).body) as Record<string, unknown>;

    assert.equal(summary["status"], "unknown");
    assert.equal(summary["unknown"], 3);
    assert.equal(summary["lastPollAt"], null);
  } finally {
    await app.close();
  }
});
