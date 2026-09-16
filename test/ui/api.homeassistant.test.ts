import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; text: string; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-ha-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = undefined;
      }
      return { status: response.status, text, body };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const save = (runtime: UiRuntime, provider: string, status: "operational" | "major_outage") =>
  runtime.store.saveStatus({
    provider,
    overallStatus: status,
    activeIncidents:
      status === "operational"
        ? []
        : [{ id: "i1", name: "Down", impact: "major", status: "investigating", updatedAt: "2026-08-21T10:00:00Z" }],
    components: [],
    maintenances: [],
    fetchedAt: "2026-08-21T10:00:00Z",
  });

type Payload = {
  fleet: { state: string; providers: number; incidents: number };
  providers: Record<string, { state: string; status: string; incidents: number; statusUrl: string }>;
};

test("a provider that is fine is OFF, which is what device_class problem expects", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "operational");
    const { status, body } = await app.get("/homeassistant");
    assert.equal(status, 200);
    const payload = body as Payload;
    assert.equal(payload.providers["github"]?.state, "OFF");
    assert.equal(payload.providers["github"]?.status, "operational");
  } finally {
    await app.close();
  }
});

test("a provider in trouble is ON, and so is the fleet sensor above it", async () => {
  const app = await api();
  try {
    await save(app.runtime, "github", "major_outage");
    const { body } = await app.get("/homeassistant");
    const payload = body as Payload;
    assert.equal(payload.providers["github"]?.state, "ON");
    assert.equal(payload.providers["github"]?.incidents, 1);
    assert.equal(payload.fleet.state, "ON");
    assert.equal(payload.fleet.incidents, 1);
  } finally {
    await app.close();
  }
});

test("providers are keyed by id, so a template never searches a list", async () => {
  const app = await api();
  try {
    const { body } = await app.get("/homeassistant");
    const payload = body as Payload;
    assert.deepEqual(Object.keys(payload.providers).sort(), ["anthropic", "cloudflare", "github"]);
    assert.equal(payload.providers["github"]?.statusUrl, "https://www.githubstatus.com");
  } finally {
    await app.close();
  }
});

test("the generated configuration names one sensor per provider, plus the fleet", async () => {
  const app = await api();
  try {
    const { status, text } = await app.get("/homeassistant/configuration.yaml");
    assert.equal(status, 200);
    assert.match(text, /unique_id: isitdown_fleet/);
    for (const provider of ["github", "cloudflare", "anthropic"]) {
      assert.match(text, new RegExp(`unique_id: isitdown_${provider}`), provider);
      assert.match(
        text,
        new RegExp(`value_template: "\\{\\{ value_json\\.providers\\.${provider}\\.state \\}\\}"`),
        provider,
      );
    }
    // One resource for every sensor: Home Assistant fetches once per interval.
    assert.equal(text.match(/resource:/g)?.length, 1);
  } finally {
    await app.close();
  }
});

test("the configuration points at the address the request came in on, not at localhost", async () => {
  const app = await api();
  try {
    const { text } = await app.get("/homeassistant/configuration.yaml");
    // Inside Home Assistant's own container, "localhost" means Home Assistant.
    assert.match(text, /resource: "http:\/\/127\.0\.0\.1:\d+\/homeassistant"/);
  } finally {
    await app.close();
  }
});
