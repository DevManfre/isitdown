import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createCatalogFeed } from "../../src/ui/catalogFeed.ts";
import { CATALOG, CATALOG_GENERATED_AT } from "../../src/adapters/catalog.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC = publicKey.export({ type: "spki", format: "pem" }).toString();
const NEWER = new Date(Date.parse(CATALOG_GENERATED_AT) + 86_400_000).toISOString();

async function database(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-catalog-feed-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES ('github', 'GitHub', 'statuspage', 'https://www.githubstatus.com', 1, ?)",
  ).run(new Date().toISOString());
  return db;
}

/** A fake GitHub raw host serving one catalog and its signature. */
function served(entries: unknown[], options: { generatedAt?: string; tamper?: boolean } = {}) {
  const text = JSON.stringify({ generatedAt: options.generatedAt ?? NEWER, entries });
  const signature = sign(null, Buffer.from(text), privateKey).toString("base64");
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    const payload = String(url).endsWith(".sig") ? signature : options.tamper === true ? text.replace("GitHub", "GitHvb") : text;
    return new Response(payload, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const moved = { id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://githubstatus.example" };

test("with the switch off nothing is fetched and the bundled list is the catalog", async () => {
  const db = await database();
  const { fetcher, calls } = served([moved]);
  const feed = createCatalogFeed({ db, logger: silent, fetch: fetcher, publicKey: PUBLIC });
  await feed.maybeRun(false);
  assert.deepEqual(calls, []);
  assert.equal(feed.entries(), CATALOG);
  assert.equal(feed.state().source, "bundled");
  assert.deepEqual(feed.proposals(), []);
});

test("a newer signed list takes over, survives a restart, and proposes the move", async () => {
  const db = await database();
  const { fetcher } = served([moved]);
  const feed = createCatalogFeed({ db, logger: silent, fetch: fetcher, publicKey: PUBLIC });
  await feed.maybeRun(true);
  assert.equal(feed.state().status, "updated");
  assert.equal(feed.state().source, "remote");
  assert.deepEqual(feed.entries(), [moved]);
  assert.deepEqual(
    feed.proposals().map((proposal) => [proposal.serviceId, proposal.to.baseUrl]),
    [["github", "https://githubstatus.example"]],
  );

  const restarted = createCatalogFeed({ db, logger: silent, fetch: served([]).fetcher, publicKey: PUBLIC });
  assert.deepEqual(restarted.entries(), [moved], "the last good copy outlives the process");
});

test("a dismissed proposal stays dismissed", async () => {
  const db = await database();
  const feed = createCatalogFeed({ db, logger: silent, fetch: served([moved]).fetcher, publicKey: PUBLIC });
  await feed.maybeRun(true);
  assert.equal(feed.dismiss("github"), true);
  assert.deepEqual(feed.proposals(), []);
  assert.equal(feed.dismiss("github"), false, "nothing left to dismiss");
});

test("a tampered list is refused and the bundled one stays in charge", async () => {
  const db = await database();
  const feed = createCatalogFeed({ db, logger: silent, fetch: served([moved], { tamper: true }).fetcher, publicKey: PUBLIC });
  await feed.maybeRun(true);
  assert.equal(feed.state().status, "failed");
  assert.equal(feed.state().source, "bundled");
  assert.equal(feed.entries(), CATALOG);
});

test("a list no newer than the bundled one changes nothing", async () => {
  const db = await database();
  const feed = createCatalogFeed({
    db,
    logger: silent,
    fetch: served([moved], { generatedAt: CATALOG_GENERATED_AT }).fetcher,
    publicKey: PUBLIC,
  });
  await feed.maybeRun(true);
  assert.equal(feed.state().status, "current");
  assert.equal(feed.entries(), CATALOG);
});

test("checks at most once a day unless forced", async () => {
  const db = await database();
  const { fetcher, calls } = served([moved]);
  const feed = createCatalogFeed({ db, logger: silent, fetch: fetcher, publicKey: PUBLIC });
  await feed.maybeRun(true);
  await feed.maybeRun(true);
  assert.equal(calls.length, 2, "one list and one signature");
  await feed.maybeRun(true, { force: true });
  assert.equal(calls.length, 4);
});

test("a host that cannot be reached is a quiet failure", async () => {
  const db = await database();
  const fetcher = (async () => {
    throw new Error("ENOTFOUND");
  }) as unknown as typeof fetch;
  const feed = createCatalogFeed({ db, logger: silent, fetch: fetcher, publicKey: PUBLIC });
  await feed.maybeRun(true);
  assert.equal(feed.state().status, "failed");
  assert.equal(feed.state().reason, "ENOTFOUND");
});
