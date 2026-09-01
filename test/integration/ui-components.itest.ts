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

test("a selected component flip notifies once and builds history", async () => {
  // Fake statuspage: a mutable summary served on every request, so the second
  // poll cycle can observe a status the first one never saw.
  const summary: {
    status: { indicator: string };
    components: { id: string; name: string; status: string; group: boolean; group_id: string | null }[];
    incidents: unknown[];
  } = {
    status: { indicator: "none" },
    components: [{ id: "cmp1", name: "API", status: "operational", group: false, group_id: null }],
    incidents: [],
  };
  const provider: Server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Webhook receiver: records every POSTed body verbatim.
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

  const dir = await mkdtemp(join(tmpdir(), "isitdown-ui-components-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { WEBHOOK_URL: receiverUrl },
    logger: silent,
  });

  let appServer: Server | undefined;
  try {
    // The seeded defaults point at real status pages; tests never touch those.
    for (const service of listServices(runtime.db)) deleteService(runtime.db, service.id);
    insertService(runtime.db, {
      id: "fake",
      name: "Fake Provider",
      adapter: "statuspage",
      baseUrl: providerUrl,
      enabled: true,
      components: [{ id: "cmp1", name: "API" }],
    });
    // Before writing this line, confirm in src/ui/db/seed.ts which `*Env` key the
    // seeded webhook channel uses (expected: `urlEnv`) and match it exactly.
    updateChannel(runtime.db, "webhook", { enabled: true, fields: { urlEnv: "WEBHOOK_URL" } });

    // 1 + 2 (fixtures above) + 3: first cycle is a baseline, never news.
    await runtime.scheduler.triggerNow();
    assert.equal(deliveries.length, 0, "a baseline poll must never notify");

    // 4. The provider now reports the component degraded.
    summary.components[0]!.status = "degraded_performance";

    // 5. Second cycle must produce exactly one notification for the transition.
    await runtime.scheduler.triggerNow();
    assert.equal(deliveries.length, 1, "exactly one notification for the component transition");
    const delivery = deliveries[0] as { message: string };
    assert.match(delivery.message, /Component API changed from Operational to Degraded/);

    // 6. The two samples recorded (baseline + degraded) must be visible through
    // the real HTTP API, not just in the store.
    appServer = runtime.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => appServer?.once("listening", () => resolve()));
    const { port } = appServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/history/components?provider=fake&days=7`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      components: { componentId: string; sampleCount: number }[];
    };
    assert.equal(body.components.length, 1);
    assert.equal(body.components[0]?.componentId, "cmp1");
    assert.equal(body.components[0]?.sampleCount, 2);

    // 7. A third, unchanged cycle must not notify again.
    await runtime.scheduler.triggerNow();
    assert.equal(deliveries.length, 1, "an unchanged cycle must not notify again");
  } finally {
    if (appServer !== undefined) {
      const server = appServer;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test("a provider scoped to its selection ignores an incident in another region", async () => {
  // Fake statuspage shaped like Cloudflare's: two regions, one component each,
  // and a page indicator that reacts to anything anywhere.
  const summary: {
    status: { indicator: string };
    components: { id: string; name: string; status: string; group: boolean; group_id: string | null }[];
    incidents: { id: string; name: string; impact: string; status: string; created_at: string; components: { id: string }[] }[];
  } = {
    status: { indicator: "none" },
    components: [
      { id: "grp-eu", name: "Europe", status: "operational", group: true, group_id: null },
      { id: "ams", name: "Amsterdam", status: "operational", group: false, group_id: "grp-eu" },
      { id: "grp-asia", name: "Asia", status: "operational", group: true, group_id: null },
      { id: "sin", name: "Singapore", status: "operational", group: false, group_id: "grp-asia" },
    ],
    incidents: [],
  };
  const provider: Server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }
    if (req.url === "/api/v2/incidents.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ incidents: [] }));
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

  const dir = await mkdtemp(join(tmpdir(), "isitdown-ui-scope-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { WEBHOOK_URL: receiverUrl },
    logger: silent,
  });

  try {
    for (const service of listServices(runtime.db)) deleteService(runtime.db, service.id);
    insertService(runtime.db, {
      id: "fake",
      name: "Fake Provider",
      adapter: "statuspage",
      baseUrl: providerUrl,
      enabled: true,
      components: [{ id: "ams", name: "Amsterdam" }],
      scopeToComponents: true,
    });
    updateChannel(runtime.db, "webhook", { enabled: true, fields: { urlEnv: "WEBHOOK_URL" } });

    await runtime.scheduler.triggerNow();
    assert.equal(deliveries.length, 0, "a baseline poll must never notify");

    // Singapore breaks: the page indicator moves and the provider opens an
    // incident there. Amsterdam is untouched, so the operator must hear nothing.
    summary.status.indicator = "major";
    summary.components[3]!.status = "major_outage";
    summary.incidents = [
      {
        id: "inc-asia",
        name: "Outage in Singapore",
        impact: "major",
        status: "investigating",
        created_at: "2026-08-19T09:00:00.000Z",
        components: [{ id: "sin" }],
      },
    ];
    await runtime.scheduler.triggerNow();
    assert.deepEqual(deliveries, [], "an incident outside the selection must stay silent");

    // Amsterdam now degrades too: that one is in scope and must arrive.
    summary.components[1]!.status = "degraded_performance";
    summary.incidents.push({
      id: "inc-eu",
      name: "Packet loss in Amsterdam",
      impact: "minor",
      status: "investigating",
      created_at: "2026-08-19T10:00:00.000Z",
      components: [{ id: "ams" }],
    });
    await runtime.scheduler.triggerNow();
    // Three: the provider's own status, folded from the selection rather than
    // from the page indicator, plus the component transition and the incident.
    const messages = deliveries.map((delivery) => (delivery as { message: string }).message);
    assert.equal(messages.length, 3, `expected three in-scope notifications, got ${messages.join(" | ")}`);
    assert.ok(
      messages.some((message) => /Amsterdam/.test(message)),
      "the in-scope component transition must be reported",
    );
    assert.ok(
      messages.every((message) => !/Singapore/.test(message)),
      "nothing from the unselected region may appear",
    );
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});
