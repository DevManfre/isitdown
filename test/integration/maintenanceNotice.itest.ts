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

/**
 * Roadmap 3.3, through the real Light runtime: a fake Statuspage that declares a
 * window ahead of time, and a webhook receiver that hears about it. The unit
 * tests prove each piece; this proves the pieces are joined — that the config
 * block reaches the poller and the change reaches the channel.
 */
async function harness(notice: string) {
  let maintenances: unknown[] = [];
  const deliveries: { change: { kind: string }; message: string }[] = [];

  const provider: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: { indicator: "none" }, incidents: [], scheduled_maintenances: maintenances }));
  });
  const receiver: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as (typeof deliveries)[number]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));

  const dir = await mkdtemp(join(tmpdir(), "isitdown-notice-e2e-"));
  const configPath = join(dir, "config.yml");
  await writeFile(
    configPath,
    `pollIntervalMinutes: 1
requestTimeoutSeconds: 2
maxRetries: 1
failureThreshold: 2
locale: en
${notice}
services:
  - name: Fake Provider
    id: fake
    adapter: statuspage
    baseUrl: http://127.0.0.1:${(provider.address() as AddressInfo).port}

notifications:
  webhook:
    enabled: true
    url: "\${WEBHOOK_URL}"
`,
    "utf8",
  );
  process.env["WEBHOOK_URL"] = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  return {
    deliveries,
    runtime: () =>
      buildLightRuntime({ configPath, dataPath: join(dir, "state.json"), env: process.env, logger: silent }),
    declare: (startsInMinutes: number) => {
      const now = Date.now();
      maintenances = [
        {
          id: "maint-1",
          name: "Database upgrade",
          status: "scheduled",
          scheduled_for: new Date(now + startsInMinutes * 60_000).toISOString(),
          scheduled_until: new Date(now + (startsInMinutes + 30) * 60_000).toISOString(),
        },
      ];
    },
    close: async () => {
      delete process.env["WEBHOOK_URL"];
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    },
  };
}

test("a declared window is announced ahead of time, once, with how soon and for how long", async () => {
  const h = await harness("delivery:\n  maintenanceNotice:\n    enabled: true\n    leadMinutes: 120\n");
  try {
    const runtime = await h.runtime();

    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 0, "a first cycle with nothing declared says nothing");

    h.declare(90);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 1);
    assert.equal(h.deliveries[0]?.change.kind, "maintenance_upcoming");
    assert.match(h.deliveries[0]?.message ?? "", /Database upgrade/);
    assert.match(h.deliveries[0]?.message ?? "", /30 min/);

    await runtime.scheduler.triggerNow();
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 1, "the same window is not announced again");

    await runtime.close();
  } finally {
    await h.close();
  }
});

test("without the block, a declared window says nothing until it starts", async () => {
  const h = await harness("");
  try {
    const runtime = await h.runtime();
    await runtime.scheduler.triggerNow();
    h.declare(30);
    await runtime.scheduler.triggerNow();
    assert.equal(h.deliveries.length, 0);
    await runtime.close();
  } finally {
    await h.close();
  }
});
