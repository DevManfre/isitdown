import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLightRuntime } from "../../src/light/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Harness {
  configPath: string;
  dataPath: string;
  /** Body the stand-in provider returns; reassign to simulate an upstream change. */
  setIndicator: (indicator: string, incidents?: unknown[]) => void;
  setMaintenance: (maintenances: unknown[]) => void;
  deliveries: { change: { kind: string; currentStatus: string }; message: string }[];
  close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  let indicator = "none";
  let incidents: unknown[] = [];
  let maintenances: unknown[] = [];
  const deliveries: Harness["deliveries"] = [];

  const provider: Server = createServer((req, res) => {
    if (req.url !== "/api/v2/summary.json") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: { indicator },
        incidents,
        scheduled_maintenances: maintenances,
      }),
    );
  });
  const receiver: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Harness["deliveries"][number]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const providerPort = (provider.address() as AddressInfo).port;
  const receiverPort = (receiver.address() as AddressInfo).port;

  const dir = await mkdtemp(join(tmpdir(), "isitdown-maintenance-e2e-"));
  const configPath = join(dir, "config.yml");
  const dataPath = join(dir, "state.json");
  await writeFile(
    configPath,
    `pollIntervalMinutes: 1
requestTimeoutSeconds: 2
maxRetries: 1
failureThreshold: 2
locale: en

services:
  - name: Fake Provider
    id: fake
    adapter: statuspage
    baseUrl: http://127.0.0.1:${providerPort}

notifications:
  webhook:
    enabled: true
    url: "\${WEBHOOK_URL}"
`,
    "utf8",
  );

  process.env["WEBHOOK_URL"] = `http://127.0.0.1:${receiverPort}/hook`;

  return {
    configPath,
    dataPath,
    deliveries,
    setIndicator: (next, nextIncidents = []) => {
      indicator = next;
      incidents = nextIncidents;
    },
    setMaintenance: (next) => {
      maintenances = next;
    },
    close: async () => {
      delete process.env["WEBHOOK_URL"];
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    },
  };
}

const build = (h: Harness) =>
  buildLightRuntime({ configPath: h.configPath, dataPath: h.dataPath, env: process.env, logger: silent });

test("a maintenance window silences a provider end to end, then reconciles on close", async () => {
  const h = await harness();
  try {
    const runtime = await build(h);

    // 1. Baseline cycle, provider operational, no window: nothing sent.
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 0, "a first cycle is a baseline, not news");

    // 2. Provider declares a running window: exactly one message, the "started" one.
    h.setMaintenance([
      {
        id: "maint-1",
        name: "Database upgrade",
        status: "in_progress",
        scheduled_for: "2026-08-19T14:00:00.000Z",
        scheduled_until: null,
      },
    ]);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 1, "a window starting must notify exactly once");
    assert.equal(h.deliveries[0]?.change.kind, "maintenance_started");
    assert.match(h.deliveries[0]?.message ?? "", /Database upgrade/);

    // 3. Provider goes major_outage while the window runs: nothing sent.
    h.setIndicator("critical", [
      {
        id: "inc-1",
        name: "Total outage",
        impact: "critical",
        status: "investigating",
        updated_at: "2026-08-19T14:15:00.000Z",
      },
    ]);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 1, "a running window must swallow the outage that started inside it");

    // 4. Provider closes the window, still major_outage: exactly one message, the
    // "ended" one, and its text names the major outage.
    h.setMaintenance([]);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 2, "closing the window must notify exactly once");
    assert.equal(h.deliveries[1]?.change.kind, "maintenance_ended");
    assert.match(h.deliveries[1]?.message ?? "", /Major outage/);

    await runtime.close();
  } finally {
    await h.close();
  }
});
