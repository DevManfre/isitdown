import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CATALOG_PUBLIC_KEY,
  catalogProposals,
  dismissalKey,
  isNewer,
  verifyCatalog,
} from "../../src/adapters/catalogFeed.ts";

/**
 * Roadmap 2.2: a downloaded catalog is believed only when it is signed with
 * the key this build ships, is a catalog, and names adapters this build has —
 * and even then it only ever proposes.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC = publicKey.export({ type: "spki", format: "pem" }).toString();
const ADAPTERS = ["statuspage", "rss"];

const body = (entries: unknown[], generatedAt = "2026-10-10T00:00:00.000Z"): string =>
  JSON.stringify({ generatedAt, entries });
const signed = (text: string): string => sign(null, Buffer.from(text), privateKey).toString("base64");

const github = { id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://www.githubstatus.com" };

test("a list signed with the matching key verifies", () => {
  const text = body([github]);
  const verified = verifyCatalog(text, signed(text), ADAPTERS, PUBLIC);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.ok && verified.catalog.entries, [github]);
});

test("one changed byte, another key, or a garbage signature is refused", () => {
  const text = body([github]);
  const signature = signed(text);
  assert.equal(verifyCatalog(text.replace("githubstatus", "githubstatvs"), signature, ADAPTERS, PUBLIC).ok, false);
  assert.equal(verifyCatalog(text, signature, ADAPTERS, CATALOG_PUBLIC_KEY).ok, false);
  assert.equal(verifyCatalog(text, "not base64 at all!", ADAPTERS, PUBLIC).ok, false);
});

test("a signed file that is not a catalog is refused rather than half-read", () => {
  const text = JSON.stringify({ hello: "world" });
  const verified = verifyCatalog(text, signed(text), ADAPTERS, PUBLIC);
  assert.deepEqual(verified, { ok: false, reason: "the signed file is not a catalog" });
});

test("rows this build cannot read are dropped, and named", () => {
  const text = body([github, { id: "future", name: "Future", adapter: "quantum", baseUrl: "https://future.example" }]);
  const verified = verifyCatalog(text, signed(text), ADAPTERS, PUBLIC);
  assert.ok(verified.ok);
  assert.deepEqual(verified.catalog.entries.map((entry) => entry.id), ["github"]);
  assert.deepEqual(verified.dropped, ["future"]);
});

test("the catalog the job published verifies against the key the code ships", () => {
  const text = readFileSync(new URL("../../catalog/catalog.json", import.meta.url), "utf8");
  const signature = readFileSync(new URL("../../catalog/catalog.json.sig", import.meta.url), "utf8");
  assert.equal(verifyCatalog(text, signature, ["statuspage", "rss", "aws", "gcp", "azure", "slack", "uptimecom", "betterstack", "instatus"]).ok, true);
});

test("only a strictly newer list replaces the bundled one", () => {
  const catalog = { generatedAt: "2026-10-10T00:00:00.000Z", entries: [] };
  assert.equal(isNewer(catalog, "2026-10-09T00:00:00.000Z"), true);
  assert.equal(isNewer(catalog, "2026-10-10T00:00:00.000Z"), false);
});

test("a configured provider whose entry moved is proposed, once per value", () => {
  const services = [
    { id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://status.github.com" },
    { id: "slack", name: "Slack", adapter: "slack", baseUrl: "https://slack-status.com" },
    { id: "own", name: "Own", adapter: "http", baseUrl: "https://app.example.com" },
  ];
  const entries = [
    github,
    { id: "slack", name: "Slack", adapter: "slack", baseUrl: "https://slack-status.com/" },
  ];
  assert.deepEqual(catalogProposals(services, entries, new Set()), [
    {
      serviceId: "github",
      name: "GitHub",
      from: { adapter: "statuspage", baseUrl: "https://status.github.com" },
      to: { adapter: "statuspage", baseUrl: "https://www.githubstatus.com" },
    },
  ]);
  assert.deepEqual(catalogProposals(services, entries, new Set([dismissalKey("github", github)])), []);
  // The catalog moving again is a new question.
  const moved = { ...github, baseUrl: "https://githubstatus.example" };
  assert.equal(catalogProposals(services, [moved], new Set([dismissalKey("github", github)])).length, 1);
});
