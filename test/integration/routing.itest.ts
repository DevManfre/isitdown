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

function receiver(): { server: Server; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return { server, bodies };
}

/**
 * Exercises the whole cycle, not the matcher in isolation: routing is only
 * proven end to end once a real poll turns a real provider change into a
 * delivery on the channel the rule named, and no delivery on the channel it
 * did not. A single catch-all rule pointed at `webhook` should route the
 * outage there and leave the `discord` channel untouched.
 */
test("first matching routing rule decides which channel hears a change", async () => {
  let indicator = "none";
  const provider: Server = createServer((req, res) => {
    if (req.url !== "/api/v2/summary.json") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: { indicator }, incidents: [] }));
  });

  const routed = receiver();
  const quiet = receiver();

  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", () => resolve()));
  await new Promise<void>((resolve) => routed.server.listen(0, "127.0.0.1", () => resolve()));
  await new Promise<void>((resolve) => quiet.server.listen(0, "127.0.0.1", () => resolve()));

  const port = (server: Server) => (server.address() as AddressInfo).port;
  const dir = await mkdtemp(join(tmpdir(), "isitdown-routing-"));
  const configPath = join(dir, "config.yml");

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
    baseUrl: http://127.0.0.1:${port(provider)}

notifications:
  webhook:
    enabled: true
    url: http://127.0.0.1:${port(routed.server)}/hook
  discord:
    enabled: true
    webhookUrl: http://127.0.0.1:${port(quiet.server)}/hook

routing:
  - provider: "*"
    classes: [status, incident]
    minSeverity: major_outage
    channels: [webhook]
`,
    "utf8",
  );

  const runtime = await buildLightRuntime({
    configPath,
    dataPath: join(dir, "state.json"),
    env: {},
    logger: silent,
  });

  try {
    // A null previous state is never news: the first cycle only
    // establishes the baseline and must notify nobody.
    await runtime.scheduler.triggerNow();
    assert.deepEqual(routed.bodies, []);
    assert.deepEqual(quiet.bodies, []);

    // "critical" is the Statuspage indicator that maps to major_outage (see
    // src/adapters/statuspage.adapter.ts INDICATORS); the rule's floor is
    // major_outage, so this is the value that must clear it.
    indicator = "critical";
    await runtime.scheduler.triggerNow();

    assert.equal(routed.bodies.length, 1, "the routed channel should have received the outage");
    assert.equal(quiet.bodies.length, 0, "the unrouted channel must stay silent");
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => routed.server.close(() => resolve()));
    await new Promise<void>((resolve) => quiet.server.close(() => resolve()));
  }
});
