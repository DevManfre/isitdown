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
  const dir = await mkdtemp(join(tmpdir(), "isitdown-feeds-api-"));
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

async function seed(runtime: UiRuntime, names: string[] = []): Promise<string[]> {
  const ids = runtime.listAllServices().map((service) => service.id);
  for (const [index, id] of ids.entries()) {
    await runtime.store.saveStatus({
      provider: id,
      overallStatus: "major_outage",
      activeIncidents: [
        incident(`${id}-1`, names[index] === undefined ? {} : { name: names[index] as string }),
      ],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });
  }
  return ids;
}

test("the RSS feed is served inline as a feed, never as a download", async () => {
  const app = await api();
  try {
    await seed(app.runtime);

    const { status, headers, text } = await app.get("/feeds/incidents.xml");

    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /^application\/rss\+xml/);
    assert.equal(headers.get("content-disposition"), null);
    assert.match(text, /<rss version="2\.0"/);
    assert.match(text, /<item>/);
  } finally {
    await app.close();
  }
});

test("the feed's self link is the url it was fetched from, filters included", async () => {
  const app = await api();
  try {
    await seed(app.runtime);

    const { text } = await app.get("/feeds/incidents.xml?state=active");

    assert.match(text, /<atom:link href="http:\/\/127\.0\.0\.1:\d+\/feeds\/incidents\.xml\?state=active"/);
  } finally {
    await app.close();
  }
});

test("an item names the provider the way the dashboard does, not by its id", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);
    const first = ids[0] as string;
    const name = app.runtime.listAllServices().find((service) => service.id === first)?.name;

    const { text } = await app.get(`/feeds/incidents.xml?provider=${first}`);

    assert.match(text, new RegExp(`<title>${name}: Elevated error rates</title>`));
  } finally {
    await app.close();
  }
});

test("the feed is the incident search's own result: the same filters narrow it", async () => {
  const app = await api();
  try {
    await seed(app.runtime, ["Database connections exhausted", "API errors above 50%", "Dashboard slow"]);

    const { text } = await app.get("/feeds/incidents.xml?q=database");

    assert.match(text, /Database connections exhausted/);
    assert.doesNotMatch(text, /Dashboard slow/);
  } finally {
    await app.close();
  }
});

test("a disabled provider leaves the feed the way it leaves the list", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);
    const off = ids[0] as string;
    updateService(app.runtime.db, off, { enabled: false });

    const { text } = await app.get("/feeds/incidents.xml");

    assert.doesNotMatch(text, new RegExp(`<guid isPermaLink="false">${off}/`));
  } finally {
    await app.close();
  }
});

test("the calendar is served as iCalendar and carries one event per incident", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);

    const { status, headers, text } = await app.get("/feeds/incidents.ics");

    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /^text\/calendar/);
    assert.equal(text.split("BEGIN:VEVENT").length - 1, ids.length);
    assert.match(text, /STATUS:TENTATIVE/);
  } finally {
    await app.close();
  }
});

test("the window a feed carries is the feed's own, not a caller's parameter", async () => {
  const app = await api();
  try {
    const ids = await seed(app.runtime);

    const { text } = await app.get("/feeds/incidents.xml?limit=1");

    // A reader polls the url it was given; letting a query parameter widen the
    // page would make the feed a second, unpaged incident API.
    assert.equal(text.split("<item>").length - 1, ids.length);
  } finally {
    await app.close();
  }
});
