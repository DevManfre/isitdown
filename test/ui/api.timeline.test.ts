import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
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

interface TimelineBody {
  days: number;
  incidents: { providerId: string; incidentId: string; name: string; impact: string; startedAt: string; resolvedAt: string | null }[];
}

async function open(runtime: UiRuntime, providerId: string, incidents: Incident[]): Promise<void> {
  await runtime.store.saveStatus({
    provider: providerId,
    overallStatus: "major_outage",
    activeIncidents: incidents,
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  });
}

// Roadmap 4.12. Not the incident list's page: a chart of "everything in the
// window" cannot be a page of twenty.
test("the timeline carries every incident in the window across providers, not a page of them", async () => {
  const app = await api();
  try {
    const [first, second] = app.runtime.listAllServices().map((service) => service.id) as [string, string];
    await open(app.runtime, first, Array.from({ length: 30 }, (_, index) => incident(`a-${index}`, { name: `Outage ${index}` })));
    await open(app.runtime, second, [incident("b-1", { name: "Other provider" })]);

    const { status, body } = await app.get("/incidents/timeline?days=7");
    const timeline = body as TimelineBody;

    assert.equal(status, 200);
    assert.equal(timeline.days, 7);
    assert.equal(timeline.incidents.length, 31);
    assert.deepEqual(
      Object.keys(timeline.incidents[0] ?? {}).sort(),
      ["impact", "incidentId", "name", "providerId", "resolvedAt", "startedAt"],
    );
  } finally {
    await app.close();
  }
});

test("the timeline leaves out a provider that is switched off", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    await open(app.runtime, providerId, [incident("gone")]);
    await app.send("PATCH", `/config/services/${providerId}`, { enabled: false });

    const timeline = (await app.get("/incidents/timeline")).body as TimelineBody;

    assert.equal(timeline.incidents.some((row) => row.providerId === providerId), false);
    assert.equal(timeline.days, 30);
  } finally {
    await app.close();
  }
});

test("the timeline refuses a window the dashboard does not offer", async () => {
  const app = await api();
  try {
    assert.equal((await app.get("/incidents/timeline?days=5")).status, 400);
  } finally {
    await app.close();
  }
});
