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
 * Provider push instead of poll — roadmap 2.10.
 *
 * What is worth holding here is not that a POST returns 200: it is that the
 * route is a *trigger*. A push must reach the same poller, the same diff engine
 * and the same dispatcher a scheduled cycle does, and must never become a
 * second way a provider's state is learned.
 */

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  post: (path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-push-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = createServer(runtime.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    post: async (path, body = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** The shape Statuspage posts, trimmed to the parts this route looks at. */
const WEBHOOK = {
  page: { id: "kctbh9vrtdwd", status_indicator: "major" },
  incident: { name: "Elevated error rates", status: "investigating" },
};

const anyProvider = (app: Api): string => app.runtime.listAllServices()[0]?.id ?? "github";

test("with no PUSH_TOKEN set the route does not exist", async () => {
  const app = await api();
  try {
    // 404 rather than 403: an instance that has not opted in should not
    // advertise that the feature is there to be guessed at.
    const { status } = await app.post(`/push/${anyProvider(app)}?token=whatever`, WEBHOOK);
    assert.equal(status, 404);
  } finally {
    await app.close();
  }
});

test("a wrong or missing token is refused", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    const provider = anyProvider(app);
    assert.equal((await app.post(`/push/${provider}`, WEBHOOK)).status, 401);
    assert.equal((await app.post(`/push/${provider}?token=wrong`, WEBHOOK)).status, 401);
  } finally {
    await app.close();
  }
});

test("a push about a provider nothing is watching is a 404", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    assert.equal((await app.post("/push/nobody?token=s3cret", WEBHOOK)).status, 404);
  } finally {
    await app.close();
  }
});

test("a body that is not a status page webhook is refused", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  try {
    const { status } = await app.post(`/push/${anyProvider(app)}?token=s3cret`, { page: "not an object" });
    assert.equal(status, 400);
  } finally {
    await app.close();
  }
});

test("a push reads that provider and nothing else", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  const provider = anyProvider(app);
  const polled: string[][] = [];
  // The scheduler is the seam the route goes through; recording what it was
  // asked for is what proves the push narrowed the cycle rather than firing a
  // fleet-wide poll at a provider's convenience.
  const original = app.runtime.scheduler.triggerFor.bind(app.runtime.scheduler);
  app.runtime.scheduler.triggerFor = async (id: string) => {
    polled.push([id]);
    return {
      changes: [],
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  };

  try {
    const { status, body } = await app.post(`/push/${provider}?token=s3cret`, WEBHOOK);
    assert.equal(status, 200);
    assert.equal((body as { status: string }).status, "polled");
    assert.deepEqual(polled, [[provider]]);
  } finally {
    app.runtime.scheduler.triggerFor = original;
    await app.close();
  }
});

test("several posts about one change cost one read", async () => {
  const app = await api({ PUSH_TOKEN: "s3cret" });
  const provider = anyProvider(app);
  let reads = 0;
  const original = app.runtime.scheduler.triggerFor.bind(app.runtime.scheduler);
  app.runtime.scheduler.triggerFor = async () => {
    reads += 1;
    return {
      changes: [],
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  };

  try {
    // Statuspage posts the incident, then one per component, within seconds.
    const first = await app.post(`/push/${provider}?token=s3cret`, WEBHOOK);
    const second = await app.post(`/push/${provider}?token=s3cret`, WEBHOOK);
    assert.equal(first.status, 200);
    assert.equal(second.status, 202);
    assert.equal((second.body as { status: string }).status, "coalesced");
    assert.equal(reads, 1);
  } finally {
    app.runtime.scheduler.triggerFor = original;
    await app.close();
  }
});

test("the push route is reachable without the read-only API token", async () => {
  // Its caller is a provider, not an operator: it cannot be handed a bearer
  // token, and it is a POST, which that token refuses on principle. It carries
  // its own credential in the URL instead.
  const app = await api({ PUSH_TOKEN: "s3cret", API_TOKEN: "other", API_LOCAL_BYPASS: "false" });
  try {
    const { status } = await app.post(`/push/${anyProvider(app)}?token=s3cret`, WEBHOOK);
    assert.notEqual(status, 401);
    assert.notEqual(status, 403);
  } finally {
    await app.close();
  }
});
