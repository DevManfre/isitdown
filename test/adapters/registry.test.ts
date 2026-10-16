import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestVersion, metadataUrl, registryAdapter } from "../../src/adapters/registry.adapter.ts";
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

const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/registry/${name}.json`, import.meta.url), "utf8"));

test("each registry's latest version is read from its own metadata shape", () => {
  // jsdelivr, cdnjs, unpkg are recorded; crates and pypi are the recorded
  // documents cut down to the fields read (the originals run to hundreds of kB).
  assert.equal(latestVersion("npm", recorded("npm")), "1.3.0");
  assert.equal(latestVersion("jsdelivr", recorded("jsdelivr")), (recorded("jsdelivr") as { versions: { version: string }[] }).versions[0]?.version);
  assert.match(latestVersion("cdnjs", recorded("cdnjs")) ?? "", /^\d+\.\d+\.\d+/);
  assert.equal(latestVersion("unpkg", recorded("unpkg")), "1.3.0");
  assert.equal(latestVersion("crates", recorded("crates")), "1.0.229");
  assert.equal(latestVersion("pypi", recorded("pypi")), "2.34.2");
  assert.equal(latestVersion("dockerhub", {}), null);
  assert.equal(latestVersion("npm", "nonsense"), null);
});

test("CDN and crates metadata urls follow each service's own route", () => {
  assert.equal(metadataUrl(service("https://crates.io", { registry: "crates", package: "serde" })), "https://crates.io/api/v1/crates/serde");
  assert.equal(metadataUrl(service("https://data.jsdelivr.com", { registry: "jsdelivr", package: "left-pad" })), "https://data.jsdelivr.com/v1/packages/npm/left-pad");
  assert.equal(metadataUrl(service("https://api.cdnjs.com", { registry: "cdnjs", package: "jquery" })), "https://api.cdnjs.com/libraries/jquery?fields=version");
  assert.equal(metadataUrl(service("https://unpkg.com", { registry: "unpkg", package: "left-pad" })), "https://unpkg.com/left-pad/package.json");
});

test("a newer major than the pin degrades with one incident; the same major, or no pin, stays operational", async () => {
  const body = JSON.stringify({ name: "left-pad", "dist-tags": { latest: "2.0.0" } });
  const at = async (pinned?: string) => {
    let out: Awaited<ReturnType<typeof registryAdapter.fetchStatus>> | undefined;
    await withServer(
      (_req, res) => res.end(body),
      async (url) => {
        out = await registryAdapter.fetchStatus(service(url, { registry: "npm", package: "left-pad", ...(pinned === undefined ? {} : { pinned }) }), { timeoutMs: 2000 });
      },
    );
    return out!;
  };
  const stale = await at("1.4.2");
  assert.equal(stale.overallStatus, "degraded");
  assert.deepEqual(stale.activeIncidents.map((i) => [i.id, i.name, i.impact]), [["left-pad@2.0.0", "left-pad 2.0.0 is out, you pin 1.4.2", "release"]]);
  assert.equal((await at("2")).overallStatus, "operational");
  assert.deepEqual((await at("2")).activeIncidents, []);
  assert.equal((await at()).overallStatus, "operational");
});

test("pinned must be a version, and cannot be used where there is none to compare", () => {
  assert.equal(registryAdapter.validateOptions?.({ registry: "npm", package: "x", pinned: "latest" }).length, 1);
  assert.equal(registryAdapter.validateOptions?.({ registry: "npm", package: "x", pinned: "1.2" }).length, 0);
  assert.equal(registryAdapter.validateOptions?.({ registry: "dockerhub", package: "library/alpine", pinned: "1" }).length, 1);
});
