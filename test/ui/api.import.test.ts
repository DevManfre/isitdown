import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * `POST /config/import/neighbour` — roadmap 2.4. The same proposals the CLI
 * prints, plus whether the fleet already watches each one; nothing is added.
 */

const silent = createLogger("error", () => {});
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url), "utf8");

interface Api {
  runtime: UiRuntime;
  post: (path: string, body: string, type: string) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-import-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = createServer(runtime.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    post: async (path, body, type) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": type }, body });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("an export sent as text is read into proposals, and nothing is added", async () => {
  const app = await api();
  try {
    const before = app.runtime.listAllServices().length;
    const { status, body } = await app.post("/config/import/neighbour", fixture("gatus-config.yaml"), "text/yaml");
    assert.equal(status, 200);
    assert.equal(body.tool, "gatus");
    assert.ok(body.services.some((proposal: any) => proposal.kind === "heartbeat" && proposal.service.id === "backup-job"));
    assert.ok(body.skipped.some((skip: any) => skip.source === "ping-router" && skip.reason === "unsupported-type"));
    assert.equal(app.runtime.listAllServices().length, before);
  } finally {
    await app.close();
  }
});

test("a proposal says whether the fleet already has that provider", async () => {
  const app = await api();
  try {
    const watched = new Set(app.runtime.listAllServices().map((service) => service.id));
    const { body } = await app.post("/config/import/neighbour?from=uptimekuma", fixture("uptimekuma-backup.json"), "text/plain");
    for (const proposal of body.services) {
      assert.equal(proposal.configured, watched.has(proposal.service.id), proposal.service.id);
    }
    // The seeded fleet watches GitHub, which the backup probes as a status page.
    assert.equal(body.services.find((proposal: any) => proposal.service.id === "github")?.configured, watched.has("github"));
  } finally {
    await app.close();
  }
});

test("the export's own JSON, posted as it stands, is read too", async () => {
  const app = await api();
  try {
    const { status, body } = await app.post("/config/import/neighbour", fixture("statusgator-monitors.json"), "application/json");
    assert.equal(status, 200);
    assert.equal(body.tool, "statusgator");
  } finally {
    await app.close();
  }
});

test("an unknown tool, an empty body or an unreadable file is a 400", async () => {
  const app = await api();
  try {
    assert.equal((await app.post("/config/import/neighbour?from=nagios", "x", "text/plain")).status, 400);
    assert.equal((await app.post("/config/import/neighbour", "   ", "text/plain")).status, 400);
    const unreadable = await app.post("/config/import/neighbour", "hello: world", "text/yaml");
    assert.equal(unreadable.status, 400);
    assert.match(unreadable.body.error.message, /not an Uptime Kuma backup/);
  } finally {
    await app.close();
  }
});
