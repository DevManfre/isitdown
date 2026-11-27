import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { insertService, listServices, purgeService } from "../../src/ui/dbServices.ts";
import { createLogger } from "../../src/core/logger.ts";
import { createReadApi } from "../../src/cli/mcp/api.ts";
import { serveMcp } from "../../src/cli/mcp/server.ts";
import { TOOLS } from "../../src/cli/mcp/tools.ts";

const silent = createLogger("error", () => {});

/**
 * Roadmap 7.1, end to end: every MCP tool against a real UI edition, so the
 * zod schemas in `src/cli/mcp/schema.ts` are proven against the payloads the
 * routes actually send, not only against the unit test's hand-written ones.
 * The provider is a fake Statuspage with one open incident.
 */
test("every MCP tool answers from a real UI edition instance", async () => {
  const startedAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const summary = {
    status: { indicator: "major" },
    components: [{ id: "cmp1", name: "API", status: "partial_outage", group: false, group_id: null }],
    incidents: [
      { id: "inc-1", name: "Elevated API errors", impact: "major", status: "investigating", created_at: startedAt, updated_at: startedAt, components: [{ id: "cmp1" }] },
    ],
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
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  const dir = await mkdtemp(join(tmpdir(), "isitdown-mcp-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  let appServer: Server | undefined;
  const input = new PassThrough();
  const output = new PassThrough();
  try {
    for (const service of listServices(runtime.db)) purgeService(runtime.db, service.id);
    insertService(runtime.db, { id: "fake", name: "Fake Provider", adapter: "statuspage", baseUrl: providerUrl, enabled: true });
    await runtime.scheduler.triggerNow();
    await runtime.store.addAnnotation({ at: new Date().toISOString(), label: "v1 shipped", colour: "accent", providerId: null });

    appServer = runtime.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => appServer?.once("listening", () => resolve()));
    const url = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

    const served = serveMcp(input, output, TOOLS, { api: createReadApi(url, ""), now: () => new Date() });
    const answers = new Map<number, { isError: boolean; content: { text: string }[] }>();
    createInterface({ input: output }).on("line", (line) => {
      const message = JSON.parse(line) as { id: number; result: { isError: boolean; content: { text: string }[] } };
      answers.set(message.id, message.result);
    });
    const today = new Date().toISOString().slice(0, 10);
    const calls: [string, unknown][] = [
      ["fleet_status", {}],
      ["provider_history", { provider: "fake", days: 7 }],
      ["incidents_search", { provider: "fake" }],
      ["status_at", { at: new Date().toISOString(), providers: ["fake"] }],
      ["annotations_list", { from: today, to: today }],
    ];
    calls.forEach(([name, args], index) => {
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id: index, method: "tools/call", params: { name, arguments: args } })}\n`);
    });
    input.end();
    await served;
    await new Promise((resolve) => setImmediate(resolve));

    const result = (index: number) => {
      const answer = answers.get(index);
      assert.ok(answer, `no answer to ${calls[index]?.[0]}`);
      assert.equal(answer.isError, false, `${calls[index]?.[0]}: ${answer.content[0]?.text}`);
      return JSON.parse(answer.content[0]?.text ?? "null");
    };

    const fleet = result(0);
    assert.equal(fleet.providers[0].id, "fake");
    assert.equal(fleet.providers[0].activeIncidents[0].name, "Elevated API errors");
    assert.equal(result(1).days.length, 7);
    assert.equal(result(2).incidents[0].incidentId, "inc-1");
    const at = result(3).providers[0];
    assert.equal(at.status, "partial_outage");
    assert.equal(at.openIncidents[0].incidentId, "inc-1");
    assert.equal(result(4).annotations[0].label, "v1 shipped");
  } finally {
    if (appServer !== undefined) {
      const server = appServer;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await runtime.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
