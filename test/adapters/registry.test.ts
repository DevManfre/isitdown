import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metadataUrl, registryAdapter } from "../../src/adapters/registry.adapter.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
import { withDeadServer, withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service = (baseUrl: string, options: Record<string, string> = { registry: "npm", package: "left-pad" }): ServiceRef => ({
  id: "npm", name: "npm", baseUrl, options,
});
const fixture = readFileSync(new URL("../fixtures/registry/npm.json", import.meta.url), "utf8");

runAdapterContract("registry", () => ({
  adapter: registryAdapter,
  service: (baseUrl) => service(baseUrl),
  ok: { "/left-pad": fixture },
  degraded: { "/left-pad": fixture },
  subject: "response",
}));

async function read(status: number, body: string, options?: Record<string, string>) {
  const notes: ReadingNote[] = [];
  const ctx: FetchContext = { timeoutMs: 2000, onNote: (n) => notes.push(n) };
  let result = "";
  await withServer(
    (_req, res) => { res.statusCode = status; res.end(body); },
    async (url) => { result = (await registryAdapter.fetchStatus(service(url, options), ctx)).overallStatus; },
  );
  return { result, notes };
}

test("package metadata answered as JSON reads operational", async () => {
  assert.equal((await read(200, fixture)).result, "operational");
});

test("a 5xx reads a major outage and says what it answered", async () => {
  const { result, notes } = await read(502, "bad gateway");
  assert.equal(result, "major_outage");
  assert.match(notes[0]?.text ?? "", /answered 502/);
});

test("a 404 degrades: the registry answered, the package is the operator's to look at", async () => {
  const { result, notes } = await read(404, "{}");
  assert.equal(result, "degraded");
  assert.match(notes[0]?.text ?? "", /has no package left-pad/);
});

test("a 2xx that is not metadata degrades, and a 429 abstains", async () => {
  assert.equal((await read(200, "<html>captive portal</html>")).result, "degraded");
  assert.equal((await read(429, "slow down")).result, "unknown");
});

test("an unreachable registry reads a major outage, flagged unreachable", async () => {
  const notes: ReadingNote[] = [];
  await withDeadServer(async (url) => {
    const status = await registryAdapter.fetchStatus(service(url), { timeoutMs: 2000, onNote: (n) => notes.push(n) });
    assert.equal(status.overallStatus, "major_outage");
  });
  assert.equal(notes[0]?.unreachable, true);
});

test("metadata urls follow each registry's own route", () => {
  assert.equal(metadataUrl(service("https://registry.npmjs.org/", { registry: "npm", package: "@scope/name" })), "https://registry.npmjs.org/@scope%2fname");
  assert.equal(metadataUrl(service("https://pypi.org", { registry: "pypi", package: "requests" })), "https://pypi.org/pypi/requests/json");
  assert.equal(metadataUrl(service("https://hub.docker.com", { registry: "dockerhub", package: "library/alpine" })), "https://hub.docker.com/v2/repositories/library/alpine/");
  assert.equal(metadataUrl(service("https://x", { registry: "npm" })), null);
});

test("options without a known registry or a package cannot be saved", () => {
  assert.equal(registryAdapter.validateOptions?.({ registry: "npm", package: "x" }).length, 0);
  assert.equal(registryAdapter.validateOptions?.({ registry: "maven" }).length, 2);
});
