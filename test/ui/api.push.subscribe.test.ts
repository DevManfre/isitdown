import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * What the dashboard reads to help the operator subscribe a provider's webhook
 * — roadmap 1.2: the URL to paste, and the receipt that proves it works.
 */

const silent = createLogger("error", () => {});

interface PushProvider {
  providerId: string;
  eligible: boolean;
  url: string | null;
  lastReceivedAt: string | null;
  received: number;
}

interface PushConfig {
  enabled: boolean;
  tokenRevealed: boolean;
  providers: PushProvider[];
}

interface Api {
  runtime: UiRuntime;
  port: number;
  get: (headers?: Record<string, string>) => Promise<PushConfig>;
  post: (path: string, body?: unknown) => Promise<number>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-push-subscribe-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  // Never reach a real provider: the read a push triggers is not what is under test.
  runtime.scheduler.triggerFor = async () => ({
    changes: [],
    results: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
  const server: Server = createServer(runtime.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    port,
    get: async (headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/config/provider-push`, { headers });
      assert.equal(response.status, 200);
      return (await response.json()) as PushConfig;
    },
    post: async (path, body = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const WEBHOOK = { page: { id: "abc", status_indicator: "minor" }, incident: { name: "Elevated errors" } };

const statuspageProvider = (app: Api): string => {
  const service = app.runtime.listAllServices().find((entry) => entry.adapter === "statuspage");
  assert.ok(service, "the seeded fleet should include a Statuspage provider");
  return service.id;
};

test("with no PUSH_TOKEN push is off, and no provider gets a URL", async () => {
  const app = await api();
  try {
    const config = await app.get();
    assert.equal(config.enabled, false);
    assert.ok(config.providers.length > 0);
    assert.ok(config.providers.every((provider) => provider.url === null));
  } finally {
    await app.close();
  }
});

test("the operator's own dashboard gets each Statuspage provider's URL, token included", async () => {
  const app = await api({ PUSH_TOKEN: "s3 cret" });
  try {
    const config = await app.get();
    const id = statuspageProvider(app);
    const provider = config.providers.find((entry) => entry.providerId === id);
    assert.equal(config.enabled, true);
    assert.equal(config.tokenRevealed, true);
    assert.equal(provider?.eligible, true);
    assert.equal(provider?.url, `http://127.0.0.1:${app.port}/push/${id}?token=s3%20cret`);
  } finally {
    await app.close();
  }
});

test("a provider the guide does not cover is listed but gets no URL", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    app.runtime.db
      .prepare(
        "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES ('aws', 'AWS', 'aws', 'https://health.aws.amazon.com', NULL, 1, ?)",
      )
      .run(new Date().toISOString());
    const provider = (await app.get()).providers.find((entry) => entry.providerId === "aws");
    assert.equal(provider?.eligible, false);
    assert.equal(provider?.url, null);
  } finally {
    await app.close();
  }
});

test("a disabled provider gets no URL, since the push route would refuse it", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    const id = statuspageProvider(app);
    app.runtime.db.prepare("UPDATE services SET enabled = 0 WHERE id = ?").run(id);
    const provider = (await app.get()).providers.find((entry) => entry.providerId === id);
    assert.equal(provider?.eligible, false);
    assert.equal(provider?.url, null);
    assert.equal(await app.post(`/push/${id}?token=s3cret`, WEBHOOK), 404);
  } finally {
    await app.close();
  }
});

test("a read-only token holder sees the URL's shape but never the push token", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret", API_TOKEN: "reader", API_LOCAL_BYPASS: "false" });
  try {
    const config = await app.get({ authorization: "Bearer reader" });
    const id = statuspageProvider(app);
    assert.equal(config.tokenRevealed, false);
    assert.equal(
      config.providers.find((entry) => entry.providerId === id)?.url,
      `http://127.0.0.1:${app.port}/push/${id}?token=<PUSH_TOKEN>`,
    );
    assert.ok(!JSON.stringify(config).includes("s3cret"));
  } finally {
    await app.close();
  }
});

test("every accepted post is receipted, a coalesced one too, and a refused one is not", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    const id = statuspageProvider(app);
    assert.equal((await app.get()).providers.find((entry) => entry.providerId === id)?.received, 0);

    assert.equal(await app.post(`/push/${id}?token=wrong`, WEBHOOK), 401);
    assert.equal(await app.post(`/push/${id}?token=s3cret`, { page: "not an object" }), 400);
    assert.equal((await app.get()).providers.find((entry) => entry.providerId === id)?.received, 0);

    assert.equal(await app.post(`/push/${id}?token=s3cret`, WEBHOOK), 200);
    assert.equal(await app.post(`/push/${id}?token=s3cret`, WEBHOOK), 202);
    const provider = (await app.get()).providers.find((entry) => entry.providerId === id);
    assert.equal(provider?.received, 2);
    assert.ok(provider?.lastReceivedAt !== null && !Number.isNaN(Date.parse(provider?.lastReceivedAt ?? "")));
  } finally {
    await app.close();
  }
});

test("a receipt survives a restart, since it is the only proof Statuspage gives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-push-receipt-"));
  const dbPath = join(dir, "isitdown.db");
  const first = await buildUiRuntime({ dbPath, env: { PUSH_TOKEN: "s3cret" }, logger: silent });
  const id = first.listAllServices().find((entry) => entry.adapter === "statuspage")!.id;
  first.db.prepare("INSERT INTO push_receipts (provider_id, received_at, count) VALUES (?, ?, 3)").run(id, "2026-10-01T10:00:00.000Z");
  await first.close();

  const app = await buildUiRuntime({ dbPath, env: { PUSH_TOKEN: "s3cret" }, logger: silent });
  const server: Server = createServer(app.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const config = (await (await fetch(`http://127.0.0.1:${port}/config/provider-push`)).json()) as PushConfig;
    const provider = config.providers.find((entry) => entry.providerId === id);
    assert.equal(provider?.lastReceivedAt, "2026-10-01T10:00:00.000Z");
    assert.equal(provider?.received, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  }
});
