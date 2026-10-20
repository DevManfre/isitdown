import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { decideOrigin, type OriginRequest } from "../../src/ui/originGuard.ts";

const silent = createLogger("error", () => {});

const base: OriginRequest = {
  method: "POST",
  path: "/config/import",
  origin: undefined,
  host: "localhost:3000",
  allowedHosts: [],
};

const cases: Array<[string, Partial<OriginRequest>, boolean]> = [
  ["GET with a foreign origin", { method: "GET", origin: "http://evil.example" }, true],
  ["POST with no origin", {}, true],
  ["POST same-origin", { origin: "http://localhost:3000" }, true],
  ["POST foreign origin", { origin: "http://evil.example" }, false],
  ["POST origin null", { origin: "null" }, false],
  ["POST unparsable origin", { origin: "::::" }, false],
  ["POST DNS rebinding", { origin: "http://evil.example", host: "evil.example" }, false],
  ["POST rebinding, host allowed", { origin: "http://evil.example", host: "evil.example", allowedHosts: ["evil.example"] }, true],
  ["POST IPv4 literal same-origin", { origin: "http://192.168.1.5:3000", host: "192.168.1.5:3000" }, true],
  ["POST IPv6 literal same-origin", { origin: "http://[::1]:3000", host: "[::1]:3000" }, true],
  ["push webhook foreign origin", { path: "/push/abc", origin: "http://evil.example" }, true],
  ["heartbeat foreign origin", { path: "/heartbeat/x", origin: "http://evil.example" }, true],
];

for (const [name, over, allow] of cases) {
  test(`decideOrigin: ${name}`, () => {
    assert.equal(decideOrigin({ ...base, ...over }).allow, allow);
  });
}

test("end to end: foreign-origin writes get 403, others reach the route", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-origin-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  try {
    // fetch forbids setting Host, but Origin is settable on Node's fetch.
    const foreign = await fetch(`${url}/poll`, { method: "POST", headers: { origin: "http://evil.example" } });
    assert.equal(foreign.status, 403);
    const imported = await fetch(`${url}/config/import`, {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "text/plain" },
      body: "providers: []",
    });
    assert.equal(imported.status, 403);
    const plain = await fetch(`${url}/poll`, { method: "POST" });
    assert.notEqual(plain.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});
