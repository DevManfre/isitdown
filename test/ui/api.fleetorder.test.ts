import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { updateService } from "../../src/ui/dbConfigSource.ts";
import { applyOrder } from "../../src/ui/fleetOrder.ts";
import { createLogger } from "../../src/core/logger.ts";

/** Roadmap 4.24: the fleet's manual order, kept by the server, honoured by `/status`. */

const silent = createLogger("error", () => {});

async function api() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-fleet-order-"));
  const runtime: UiRuntime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  return {
    runtime,
    call,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

type Status = { providers: { id: string }[]; groups: { id: string }[] };
const ids = (body: unknown, key: "providers" | "groups") => (body as Status)[key].map((entry) => entry.id);

test("applyOrder ranks named ids first and keeps the rest in their own order", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(applyOrder(items, []).map((i) => i.id), ["a", "b", "c", "d"]);
  assert.deepEqual(applyOrder(items, ["c", "a"]).map((i) => i.id), ["c", "a", "b", "d"]);
  // An id nobody carries any more ranks nothing.
  assert.deepEqual(applyOrder(items, ["gone", "d"]).map((i) => i.id), ["d", "a", "b", "c"]);
});

test("the fleet order is empty — automatic — until one is saved", async () => {
  const app = await api();
  try {
    const { body } = await app.call("GET", "/api/preferences");
    assert.deepEqual((body as { fleetOrder: string[] }).fleetOrder, []);
    assert.deepEqual((body as { groupOrder: string[] }).groupOrder, []);
    const status = await app.call("GET", "/status");
    assert.deepEqual(ids(status.body, "providers"), ["anthropic", "cloudflare", "github"]);
  } finally {
    await app.close();
  }
});

test("a saved order round-trips and reorders /status", async () => {
  const app = await api();
  try {
    const patched = await app.call("PATCH", "/api/preferences", { fleetOrder: ["github", "anthropic"] });
    assert.equal(patched.status, 200);
    assert.deepEqual((patched.body as { fleetOrder: string[] }).fleetOrder, ["github", "anthropic"]);
    const status = await app.call("GET", "/status");
    // Cloudflare was never placed, so it follows the ones that were.
    assert.deepEqual(ids(status.body, "providers"), ["github", "anthropic", "cloudflare"]);

    const cleared = await app.call("PATCH", "/api/preferences", { fleetOrder: [] });
    assert.deepEqual((cleared.body as { fleetOrder: string[] }).fleetOrder, []);
    const back = await app.call("GET", "/status");
    assert.deepEqual(ids(back.body, "providers"), ["anthropic", "cloudflare", "github"]);
  } finally {
    await app.close();
  }
});

test("groups follow the saved group order", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "github", { group: "deploy" });
    updateService(app.runtime.db, "cloudflare", { group: "edge" });
    const before = await app.call("GET", "/status");
    assert.deepEqual(ids(before.body, "groups"), ["deploy", "edge"]);
    await app.call("PATCH", "/api/preferences", { groupOrder: ["edge", "deploy"] });
    const after = await app.call("GET", "/status");
    assert.deepEqual(ids(after.body, "groups"), ["edge", "deploy"]);
  } finally {
    await app.close();
  }
});

test("an order that is not a list of slugs is refused", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("PATCH", "/api/preferences", { fleetOrder: ["GitHub!"] })).status, 400);
    assert.equal((await app.call("PATCH", "/api/preferences", { fleetOrder: ["a,b"] })).status, 400);
    assert.equal((await app.call("PATCH", "/api/preferences", { groupOrder: "edge" })).status, 400);
    assert.equal((await app.call("PATCH", "/api/preferences", { fleetOrder: ["a", "a"] })).status, 400);
  } finally {
    await app.close();
  }
});
