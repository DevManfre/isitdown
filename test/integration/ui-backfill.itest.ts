import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { deleteService, insertService, listServices, updateChannel } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});
const DAY_MS = 24 * 3600 * 1000;
// Pinned to a mid-day hour so the incident window never straddles a UTC
// midnight — the daily-bucket assertion below depends on the calendar day.
const midday = (daysAgo: number, hour: number): string => {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

test("boot backfills the charts from incident history without a single notification", async () => {
  // Stand-in provider: current status operational, one resolved major 10 days ago.
  const provider: Server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { indicator: "none" }, incidents: [] }));
      return;
    }
    if (req.url === "/api/v2/incidents.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          incidents: [
            {
              id: "inc-hist",
              name: "Elevated error rates",
              impact: "major",
              status: "resolved",
              created_at: midday(10, 10),
              updated_at: midday(10, 13),
              resolved_at: midday(10, 13),
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const deliveries: unknown[] = [];
  const receiver: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const dir = await mkdtemp(join(tmpdir(), "isitdown-ui-backfill-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { WEBHOOK_URL: receiverUrl },
    logger: silent,
  });

  try {
    // The seeded defaults point at real status pages; tests never touch those.
    for (const service of listServices(runtime.db)) deleteService(runtime.db, service.id);
    insertService(runtime.db, {
      id: "fake",
      name: "Fake Provider",
      adapter: "statuspage",
      baseUrl: providerUrl,
      enabled: true,
    });
    // Before writing this line, confirm in src/ui/db/seed.ts which `*Env` key the
    // seeded webhook channel uses (expected: `urlEnv`) and match it exactly.
    updateChannel(runtime.db, "webhook", { enabled: true, fields: { urlEnv: "WEBHOOK_URL" } });

    // Same order as server.ts: backfill first, then the first poll cycle.
    await runtime.backfill.backfillAll();
    await runtime.scheduler.triggerNow();

    const history = await runtime.history.getProviderHistory("fake", 90, 3);
    const badDay = midday(10, 10).slice(0, 10);
    const bucket = history.buckets.find((entry) => entry.day === badDay);
    assert.equal(bucket?.status, "partial_outage", "the incident day must show on the bars");
    assert.ok(history.uptime90 > 0 && history.uptime90 < 100, "uptime must be measured and imperfect");
    assert.ok(history.buckets.filter((entry) => entry.status !== "unknown").length >= 89);

    const incidents = await runtime.store.listIncidents({ providerId: "fake" });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.incidentId, "inc-hist");
    assert.notEqual(incidents[0]?.resolvedAt, null);

    assert.equal(deliveries.length, 0, "reconstructed history must never notify");
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test("a restart after backfill neither duplicates samples nor notifies", async () => {
  const provider: Server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { indicator: "none" }, incidents: [] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ incidents: [] }));
  });
  const deliveries: unknown[] = [];
  const receiver: Server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      deliveries.push(true);
      res.writeHead(200);
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const dir = await mkdtemp(join(tmpdir(), "isitdown-ui-backfill2-"));
  const dbPath = join(dir, "isitdown.db");
  const env = { WEBHOOK_URL: receiverUrl };

  try {
    let countAfterFirst: number;

    // First runtime lifecycle
    let first: Awaited<ReturnType<typeof buildUiRuntime>> | null = null;
    try {
      first = await buildUiRuntime({ dbPath, env, logger: silent });
      for (const service of listServices(first.db)) deleteService(first.db, service.id);
      insertService(first.db, { id: "fake", name: "Fake", adapter: "statuspage", baseUrl: providerUrl, enabled: true });
      updateChannel(first.db, "webhook", { enabled: true, fields: { urlEnv: "WEBHOOK_URL" } });
      await first.backfill.backfillAll();
      await first.scheduler.triggerNow();
      countAfterFirst = (first.db.prepare("SELECT COUNT(*) AS n FROM status_samples").get() as { n: number }).n;
    } finally {
      if (first) await first.close();
    }

    // Second runtime lifecycle
    const second = await buildUiRuntime({ dbPath, env, logger: silent });
    try {
      await second.backfill.backfillAll();
      await second.scheduler.triggerNow();
      const countAfterSecond = (second.db.prepare("SELECT COUNT(*) AS n FROM status_samples").get() as { n: number }).n;
      assert.equal(countAfterSecond, countAfterFirst + 1, "restart adds only its own poll sample");
      assert.equal(deliveries.length, 0, "reconstructed history must never notify");
    } finally {
      await second.close();
    }
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});
