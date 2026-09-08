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

interface Api {
  runtime: UiRuntime;
  request: (method: string, path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-debug-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    request: async (method, path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** A provider whose "status page" is whatever the test hands it. */
async function fakeProvider(handler: (url: string) => { status: number; body: string }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    const answer = handler(req.url ?? "");
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("the debug panel lists every provider with its adapter and options", async () => {
  const it = await api();
  try {
    const { status, body } = await it.request("GET", "/debug/adapters");
    assert.equal(status, 200);
    const { providers } = body as { providers: { id: string; adapter: string; probes: unknown[] }[] };
    assert.deepEqual(
      providers.map((provider) => provider.id).sort(),
      ["anthropic", "cloudflare", "github"],
    );
    // Nothing has been polled yet, and an empty list is the honest answer.
    assert.deepEqual(providers[0]?.probes, []);
    assert.equal(providers[0]?.adapter, "statuspage");
  } finally {
    await it.close();
  }
});

test("a cycle's outcomes reach the panel, failures with their error", async () => {
  const it = await api();
  const broken = await fakeProvider(() => ({ status: 500, body: "nope" }));
  try {
    // One provider only, pointed at a page that cannot be read.
    it.runtime.db.prepare("DELETE FROM services WHERE id != 'github'").run();
    it.runtime.db.prepare("UPDATE services SET base_url = ? WHERE id = 'github'").run(broken.baseUrl);

    await it.runtime.scheduler.triggerNow();

    const { body } = await it.request("GET", "/debug/adapters");
    const [provider] = (body as { providers: { probes: { ok: boolean; error?: string }[] }[] }).providers;
    assert.equal(provider?.probes.length, 1);
    assert.equal(provider?.probes[0]?.ok, false);
    assert.match(provider?.probes[0]?.error ?? "", /HTTP 500/);
  } finally {
    await broken.close();
    await it.close();
  }
});

test("a live probe reports the whole reading, and records nothing", async () => {
  const it = await api();
  const provider = await fakeProvider(() => ({
    status: 200,
    body: JSON.stringify({ status: { indicator: "major" }, incidents: [] }),
  }));
  try {
    it.runtime.db.prepare("UPDATE services SET base_url = ? WHERE id = 'github'").run(provider.baseUrl);

    const { status, body } = await it.request("POST", "/debug/adapters/github/probe");
    assert.equal(status, 200);
    const result = body as { ok: boolean; status?: { overallStatus: string } };
    assert.equal(result.ok, true);
    assert.equal(result.status?.overallStatus, "partial_outage");

    // Read-only towards the fleet, like the connection test: no sample, and
    // nothing in the panel's own recent reads either.
    const samples = it.runtime.db.prepare("SELECT COUNT(*) AS n FROM status_samples").get() as { n: number };
    assert.equal(samples.n, 0);
    const { body: panel } = await it.request("GET", "/debug/adapters");
    const [row] = (panel as { providers: { id: string; probes: unknown[] }[] }).providers.filter(
      (entry) => entry.id === "github",
    );
    assert.deepEqual(row?.probes, []);
  } finally {
    await provider.close();
    await it.close();
  }
});

test("a probe of an unreadable page answers with the adapter's own error", async () => {
  const it = await api();
  const provider = await fakeProvider(() => ({ status: 200, body: "<html>login</html>" }));
  try {
    it.runtime.db.prepare("UPDATE services SET base_url = ? WHERE id = 'github'").run(provider.baseUrl);
    const { status, body } = await it.request("POST", "/debug/adapters/github/probe");
    // 200 with ok:false, like the connection test: a provider that cannot be
    // read is an answer, not a failure of the dashboard to give one.
    assert.equal(status, 200);
    const result = body as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not JSON|statuspage/);
  } finally {
    await provider.close();
    await it.close();
  }
});

test("a probe of a provider that does not exist is a 404", async () => {
  const it = await api();
  try {
    const { status } = await it.request("POST", "/debug/adapters/nope/probe");
    assert.equal(status, 404);
  } finally {
    await it.close();
  }
});
