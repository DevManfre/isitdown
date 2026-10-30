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

interface SearchBody {
  query: string;
  incidents: { providerId: string; incidentId: string; name: string }[];
  notes: { providerId: string; incidentId: string; incidentName: string | null; body: string }[];
  annotations: { label: string; providerId: string | null }[];
}

/** One named incident on the first seeded provider; returns that provider's id. */
async function seedIncident(runtime: UiRuntime, name: string): Promise<string> {
  const [providerId] = runtime.listAllServices().map((service) => service.id) as [string];
  await runtime.store.saveStatus({
    provider: providerId,
    overallStatus: "major_outage",
    activeIncidents: [incident("inc-1", { name })],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  });
  return providerId;
}

// Roadmap 4.15. One question, answered from every place an operator wrote or a
// provider published free text.
test("a search finds the same word in an incident title, an operator note and an annotation", async () => {
  const app = await api();
  try {
    const providerId = await seedIncident(app.runtime, "Database connections exhausted");
    await app.send("POST", `/incidents/${providerId}/inc-1/notes`, { body: "Root cause was the database pool." });
    await app.send("POST", "/annotations", { at: new Date().toISOString(), label: "Database migration", colour: "accent" });
    await app.send("POST", "/annotations", { at: new Date().toISOString(), label: "Unrelated deploy", colour: "accent" });

    const { status, body } = await app.get("/search?q=DATABASE");
    const found = body as SearchBody;

    assert.equal(status, 200);
    assert.deepEqual(found.incidents.map((row) => row.name), ["Database connections exhausted"]);
    assert.deepEqual(found.notes.map((row) => row.body), ["Root cause was the database pool."]);
    // The note names the incident it is on, so a result can say where it leads.
    assert.equal(found.notes[0]?.incidentName, "Database connections exhausted");
    assert.deepEqual(found.annotations.map((row) => row.label), ["Database migration"]);
  } finally {
    await app.close();
  }
});

test("a search for text with a LIKE wildcard in it matches that text, not everything", async () => {
  const app = await api();
  try {
    await seedIncident(app.runtime, "Errors above 50% of requests");

    const percent = (await app.get("/search?q=50%25")).body as SearchBody;
    const underscore = (await app.get("/search?q=_")).body as SearchBody;

    assert.equal(percent.incidents.length, 1);
    assert.equal(underscore.incidents.length, 0);
  } finally {
    await app.close();
  }
});

test("a search too short to mean anything answers empty rather than listing everything", async () => {
  const app = await api();
  try {
    await seedIncident(app.runtime, "Database connections exhausted");

    for (const path of ["/search", "/search?q=", "/search?q=d", "/search?q=%20%20"]) {
      const found = (await app.get(path)).body as SearchBody;
      assert.deepEqual([found.incidents, found.notes, found.annotations], [[], [], []], path);
    }
  } finally {
    await app.close();
  }
});

test("a search caps each group, so one chatty provider cannot fill the palette", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    await app.runtime.store.saveStatus({
      provider: providerId,
      overallStatus: "major_outage",
      activeIncidents: Array.from({ length: 12 }, (_, index) => incident(`inc-${index}`, { name: `Outage ${index}` })),
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });

    const found = (await app.get("/search?q=outage")).body as SearchBody;

    assert.equal(found.incidents.length, 8);
  } finally {
    await app.close();
  }
});
