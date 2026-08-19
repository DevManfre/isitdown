import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  deliveries: { change: { kind: string; currentStatus: string }; message: string }[];
  /** Stops only the stand-in provider, leaving the config and receiver usable. */
  stopProvider: () => Promise<void>;
  close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  let indicator = "none";
  let incidents: unknown[] = [];
  const deliveries: Harness["deliveries"] = [];

  const provider: Server = createServer((req, res) => {
    if (req.url !== "/api/v2/summary.json") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: { indicator }, incidents }));
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

  const dir = await mkdtemp(join(tmpdir(), "isitdown-e2e-"));
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
    stopProvider: () => new Promise<void>((resolve) => provider.close(() => resolve())),
    close: async () => {
      delete process.env["WEBHOOK_URL"];
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    },
  };
}

const build = (h: Harness) =>
  buildLightRuntime({ configPath: h.configPath, dataPath: h.dataPath, env: process.env, logger: silent });

test("a status transition notifies exactly once, and a restart notifies nothing", async () => {
  const h = await harness();
  try {
    const runtime = await build(h);

    // 1. Baseline: the first cycle records state and must not notify.
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 0, "a first cycle is a baseline, not news");
    assert.match(await readFile(h.dataPath, "utf8"), /"fake"/);

    // 2. The provider degrades: exactly one notification.
    h.setIndicator("major", [
      {
        id: "inc-1",
        name: "Elevated error rates",
        impact: "major",
        status: "investigating",
        updated_at: "2026-08-19T14:32:07.000Z",
      },
    ]);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 2, "one status change plus one opened incident");
    assert.deepEqual(
      h.deliveries.map((delivery) => delivery.change.kind).sort(),
      ["incident_opened", "status_change"],
    );
    const statusChange = h.deliveries.find((delivery) => delivery.change.kind === "status_change");
    assert.equal(statusChange?.change.currentStatus, "partial_outage");
    assert.match(statusChange?.message ?? "", /Fake Provider/);

    // 3. Nothing changed upstream: no further notification.
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 2, "an unchanged cycle must stay silent");

    // 4. Restart against the same state file: still nothing.
    await runtime.close();
    const restarted = await build(h);
    await restarted.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 2, "a restart must not re-notify what it already knew");
    await restarted.close();
  } finally {
    await h.close();
  }
});

test("a recovery notifies, and the incident is reported as resolved", async () => {
  const h = await harness();
  try {
    const runtime = await build(h);
    h.setIndicator("critical", [
      { id: "inc-1", name: "Total outage", impact: "critical", status: "investigating", updated_at: "2026-08-19T14:00:00.000Z" },
    ]);
    await runtime.scheduler.triggerNow();
    h.deliveries.length = 0;

    h.setIndicator("none", []);
    await runtime.scheduler.triggerNow();

    assert.deepEqual(
      h.deliveries.map((delivery) => delivery.change.kind).sort(),
      ["incident_resolved", "status_change"],
    );
    const resolved = h.deliveries.find((delivery) => delivery.change.kind === "incident_resolved");
    assert.match(resolved?.message ?? "", /RESOLVED/);
    await runtime.close();
  } finally {
    await h.close();
  }
});

test("the state file never contains the resolved webhook secret", async () => {
  const h = await harness();
  try {
    const runtime = await build(h);
    await runtime.scheduler.triggerNow();
    const state = await readFile(h.dataPath, "utf8");
    assert.ok(!state.includes("/hook"), "a resolved secret must never be persisted");
    await runtime.close();
  } finally {
    await h.close();
  }
});

test("an unreachable provider keeps the last known state and warns once at the threshold", async () => {
  const h = await harness();
  try {
    const runtime = await build(h);
    h.setIndicator("minor");
    await runtime.scheduler.triggerNow();
    h.deliveries.length = 0;

    // Kill the provider mid-run: the poller must not lose what it already knew.
    await h.stopProvider();

    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 0, "one failure is not yet a warning");
    await runtime.scheduler.triggerNow();
    assert.deepEqual(
      h.deliveries.map((delivery) => delivery.change.kind),
      ["monitoring_degraded"],
    );
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 1, "the warning must not repeat every cycle");

    const state = JSON.parse(await readFile(h.dataPath, "utf8")) as {
      providers: Record<string, { last: { overallStatus: string } | null }>;
    };
    assert.equal(state.providers["fake"]?.last?.overallStatus, "degraded");
    await runtime.close();
  } finally {
    await h.close();
  }
});

test("a broken configuration refuses to build and says why", async () => {
  const h = await harness();
  try {
    await writeFile(h.configPath, "services: []\n", "utf8");
    await assert.rejects(build(h), /services/);
  } finally {
    await h.close();
  }
});

test("the entrypoint stays alive between cycles and shuts down cleanly on SIGTERM", async () => {
  const h = await harness();
  try {
    const child = spawn(process.execPath, ["src/light/index.ts"], {
      env: { ...process.env, CONFIG_PATH: h.configPath, DATA_PATH: h.dataPath, LOG_LEVEL: "info" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    // Long enough for the first cycle to finish, far short of the one-minute
    // interval: a process that exits in this window has stopped polling for good.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(child.exitCode, null, `the poller exited early: ${output}`);
    assert.match(output, /poll cycle finished/);

    child.kill("SIGTERM");
    assert.equal(await exited, 0, "SIGTERM must be a clean shutdown");
  } finally {
    await h.close();
  }
});
