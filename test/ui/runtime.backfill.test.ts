import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function freshRuntime(): Promise<UiRuntime> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-rt-backfill-"));
  return buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
}

test("building the runtime exposes the backfill service but never runs it", async () => {
  const runtime = await freshRuntime();
  try {
    assert.equal(typeof runtime.backfill.backfillAll, "function");
    const [count] = runtime.db.prepare("SELECT COUNT(*) AS n FROM status_samples").all() as { n: number }[];
    assert.equal(count?.n, 0, "a built runtime must not have fetched anything");
  } finally {
    await runtime.close();
  }
});

test("adding a service over HTTP backfills it in the background", async () => {
  // A stand-in provider so the fired backfill has somewhere local to go.
  const provider: Server = createServer((req, res) => {
    if (req.url !== "/api/v2/incidents.json") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        incidents: [
          {
            id: "h1",
            name: "API errors",
            impact: "major",
            status: "resolved",
            created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 5 * 24 * 3600 * 1000 + 3600 * 1000).toISOString(),
            resolved_at: new Date(Date.now() - 5 * 24 * 3600 * 1000 + 3600 * 1000).toISOString(),
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  const runtime = await freshRuntime();
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/config/services`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "fake",
        name: "Fake Provider",
        adapter: "statuspage",
        baseUrl: providerUrl,
        enabled: true,
      }),
    });
    assert.equal(response.status, 201);

    // Fire-and-forget: poll the database until the backfill lands.
    const deadline = Date.now() + 5000;
    let count = 0;
    while (Date.now() < deadline) {
      const [row] = runtime.db
        .prepare("SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = 'fake'")
        .all() as { n: number }[];
      count = row?.n ?? 0;
      if (count > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(count > 0, "the added service must gain backfilled samples");
    assert.equal((await runtime.store.getState("fake")).last, null, "backfill must not create a baseline");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
