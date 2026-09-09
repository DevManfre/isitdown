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
  get: (path: string) => Promise<{ status: number; text: string; headers: Headers }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-export-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: response.status, text: await response.text(), headers: response.headers };
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

/** One incident per provider, named so a search and a CSV field both have something to bite on. */
async function seed(runtime: UiRuntime, names: string[] = []): Promise<string[]> {
  const ids = runtime.listAllServices().map((service) => service.id);
  for (const [index, id] of ids.entries()) {
    await runtime.store.saveStatus({
      provider: id,
      overallStatus: "major_outage",
      activeIncidents: [incident(`${id}-1`, names[index] === undefined ? {} : { name: names[index] as string })],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });
  }
  return ids;
}

const rows = (csv: string): string[] => csv.trimEnd().split("\r\n");

test("the incident export is served as a dated download, not as a page", async () => {
  const app = await api();
  try {
    await seed(app.runtime);

    const { status, headers, text } = await app.get("/export/incidents.csv");

    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(
      headers.get("content-disposition") ?? "",
      /^attachment; filename="isitdown-incidents-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    assert.equal(
      rows(text)[0],
      "provider_id,incident_id,name,impact,status,started_at,updated_at,resolved_at",
    );
  } finally {
    await app.close();
  }
});

test("a field carrying a comma, a quote or a newline survives the round trip", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime, ['Errors on "checkout", eu-west\nand ap-south']);

    const { text } = await app.get(`/export/incidents.csv?provider=${ids[0] as string}`);

    // RFC 4180: the whole field is quoted and the embedded quotes are doubled,
    // so the newline inside it does not start a row.
    assert.match(text, /"Errors on ""checkout"", eu-west\nand ap-south"/);
    assert.equal(rows(text).length, 2, "the embedded newline must not split the record");
  } finally {
    await app.close();
  }
});

test("the export is the incident search's own result: the same filters narrow it", async () => {
  const app = await api();
  try {
    await seed(app.runtime, ["Database connections exhausted", "API errors above 50%", "Dashboard slow"]);

    const { text } = await app.get("/export/incidents.csv?q=database");

    assert.equal(rows(text).length, 2, `expected one row, got:\n${text}`);
    assert.match(text, /Database connections exhausted/);
    assert.doesNotMatch(text, /Dashboard slow/);
  } finally {
    await app.close();
  }
});

test("a resolved-only export leaves out the open incidents", async () => {
  const app = await api();
  try {
    await seed(app.runtime);

    const { text } = await app.get("/export/incidents.csv?state=resolved");

    assert.equal(rows(text).length, 1, "header only: nothing has resolved yet");
  } finally {
    await app.close();
  }
});

test("a disabled provider is left out of the export, the way it is left out of the list", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);
    const off = ids[0] as string;
    updateService(app.runtime.db, off, { enabled: false });

    const { text } = await app.get("/export/incidents.csv");

    assert.doesNotMatch(text, new RegExp(`^${off},`, "m"));
    assert.equal(rows(text).length, ids.length, `header plus ${ids.length - 1} rows`);
  } finally {
    await app.close();
  }
});

test("the JSON export names the filter it was taken with", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);
    const provider = ids[0] as string;

    const { headers, text } = await app.get(`/export/incidents.json?provider=${provider}&state=active&days=30`);

    assert.match(headers.get("content-type") ?? "", /^application\/json/);
    const body = JSON.parse(text) as {
      filter: { provider: string; state: string; query: string | null; days: number | null };
      count: number;
      truncated: boolean;
      incidents: { providerId: string }[];
    };
    assert.deepEqual(body.filter, { provider, state: "active", query: null, days: 30 });
    assert.equal(body.count, 1);
    assert.equal(body.truncated, false);
    assert.deepEqual(
      body.incidents.map((row) => row.providerId),
      [provider],
    );
  } finally {
    await app.close();
  }
});

test("the history export carries one row per provider per day, with the status and the uptime", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);

    const { status, headers, text } = await app.get("/export/history.csv?days=7");

    assert.equal(status, 200);
    assert.match(
      headers.get("content-disposition") ?? "",
      /^attachment; filename="isitdown-history-7d-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = rows(text);
    assert.equal(lines[0], "provider_id,day,worst_status,uptime_pct");
    assert.equal(lines.length, 1 + ids.length * 7, "seven days for every enabled provider");
    assert.match(text, /^[a-z0-9-]+,\d{4}-\d{2}-\d{2},[a-z_]+,\d*\.?\d*$/m);
  } finally {
    await app.close();
  }
});

test("a history export scoped to one provider carries only that provider", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);
    const provider = ids[1] as string;

    const { text } = await app.get(`/export/history.csv?days=7&provider=${provider}`);

    const providers = new Set(rows(text).slice(1).map((line) => line.split(",")[0]));
    assert.deepEqual([...providers], [provider]);
  } finally {
    await app.close();
  }
});

test("a window the charts do not offer is refused with the ones that exist", async () => {
  const app = await api();
  try {
    const { status, text } = await app.get("/export/history.csv?days=5");

    assert.equal(status, 400);
    assert.match(text, /days must be one of 7, 30, 90/);
  } finally {
    await app.close();
  }
});

test("an unknown provider is a 404 rather than an empty export that looks valid", async () => {
  const app = await api();
  try {
    const { status, text } = await app.get("/export/history.csv?provider=nope");

    assert.equal(status, 404);
    assert.match(text, /unknown provider: nope/);
  } finally {
    await app.close();
  }
});
