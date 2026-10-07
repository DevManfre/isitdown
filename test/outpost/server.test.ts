import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getAdapter } from "../../src/adapters/index.ts";
import { createLogger } from "../../src/core/logger.ts";
import { outpostResponseSchema } from "../../src/core/outpost.ts";
import { createOutpostServer } from "../../src/outpost/server.ts";

const silent = createLogger("error", () => {});

async function listen(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withOutpost(run: (url: string) => Promise<void>): Promise<void> {
  const outpost = await listen(createOutpostServer({ token: "s3cret", getAdapter, logger: silent }));
  try {
    await run(outpost.url);
  } finally {
    await outpost.close();
  }
}

const probe = (url: string, body: unknown, token = "s3cret"): Promise<Response> =>
  fetch(`${url}/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

test("the outpost runs the probe it is sent and answers with the reading", async () => {
  const target = await listen(
    createServer((_req, res) => {
      res.writeHead(503);
      res.end("busy");
    }),
  );
  try {
    await withOutpost(async (url) => {
      const response = await probe(url, {
        adapter: "http",
        service: { id: "api", name: "API", baseUrl: target.url },
        timeoutMs: 2000,
      });
      assert.equal(response.status, 200);
      const answer = outpostResponseSchema.parse(await response.json());
      assert.equal(answer.status.provider, "api");
      assert.equal(answer.status.overallStatus, "major_outage");
      assert.match(answer.note?.text ?? "", /503/);
    });
  } finally {
    await target.close();
  }
});

test("the outpost refuses a missing or wrong token", async () => {
  await withOutpost(async (url) => {
    const body = { adapter: "http", service: { id: "a", name: "a", baseUrl: "http://127.0.0.1:1" }, timeoutMs: 500 };
    assert.equal((await probe(url, body, "wrong")).status, 401);
    const bare = await fetch(`${url}/probe`, { method: "POST", body: JSON.stringify(body) });
    assert.equal(bare.status, 401);
  });
});

test("the outpost runs probes only, never a status page adapter", async () => {
  await withOutpost(async (url) => {
    const response = await probe(url, {
      adapter: "statuspage",
      service: { id: "github", name: "GitHub", baseUrl: "https://www.githubstatus.com" },
      timeoutMs: 1000,
    });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /only runs probes/);
  });
});

test("the outpost answers 400 to a body that is not a probe, and to an unknown adapter", async () => {
  await withOutpost(async (url) => {
    assert.equal((await probe(url, { adapter: "http" })).status, 400);
    const unknown = await probe(url, {
      adapter: "nope",
      service: { id: "a", name: "a", baseUrl: "http://127.0.0.1:1" },
      timeoutMs: 500,
    });
    assert.equal(unknown.status, 400);
    const notJson = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { authorization: "Bearer s3cret" },
      body: "{",
    });
    assert.equal(notJson.status, 400);
  });
});

test("the outpost has an open health route and nothing else", async () => {
  await withOutpost(async (url) => {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/status`)).status, 404);
    assert.equal((await fetch(`${url}/probe`)).status, 405);
  });
});
