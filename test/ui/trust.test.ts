import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createTrustService, EPISODE_FLOOR, type TrustPair } from "../../src/ui/trust.ts";
import type { DatabaseSync } from "node:sqlite";

/**
 * Provider trust card — roadmap 8.1, the stored half.
 *
 * `trustEpisodes.test.ts` holds the arithmetic to a table of hand-written
 * samples; this file holds the storage to the three things that can only go
 * wrong once a database is involved: the resume point, writing the same episode
 * twice, and the floor being applied inside the selected window.
 */

const START = Date.parse("2026-09-01T00:00:00.000Z");
const MINUTE = 60_000;
const PAIR: TrustPair = { probeId: "acme-probe", pageId: "acme", componentId: "" };

async function database(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-trust-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run("acme-probe", "Acme probe", "http", "https://acme.example/health", new Date(START).toISOString());
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run("acme", "Acme", "statuspage", "https://status.acme.example", new Date(START).toISOString());
  return db;
}

/** Writes one sample per minute from `offsetMinutes`, one character each. */
function samples(db: DatabaseSync, providerId: string, spec: string, offsetMinutes = 0): void {
  const insert = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok, latency_ms) VALUES (?, ?, ?, ?, NULL)",
  );
  [...spec].forEach((character, index) => {
    const at = new Date(START + (offsetMinutes + index) * MINUTE).toISOString();
    if (character === ".") insert.run(providerId, at, "operational", 1);
    else if (character === "x") insert.run(providerId, at, "major_outage", 1);
    else insert.run(providerId, at, "unknown", 0);
  });
}

/** One disagreement per block: probe down for three minutes, page silent. */
function disagreements(db: DatabaseSync, count: number): void {
  for (let index = 0; index < count; index += 1) {
    samples(db, "acme-probe", "..xxx.", index * 6);
    samples(db, "acme", "......", index * 6);
  }
}

test("a rebuild writes an episode per closed disagreement", async () => {
  const db = await database();
  disagreements(db, 3);
  const trust = createTrustService(db);
  assert.equal(trust.rebuild([PAIR]), 3);
  const rows = trust.episodes(PAIR, 3650, new Date(START + 100 * MINUTE));
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.outcome, "never");
  assert.equal(rows[0]!.excluded, null);
});

test("a second rebuild writes nothing — the same episode is never stored twice", async () => {
  const db = await database();
  disagreements(db, 3);
  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  assert.equal(trust.rebuild([PAIR]), 0);
  assert.equal(trust.episodes(PAIR, 3650, new Date(START + 100 * MINUTE)).length, 3);
});

test("a rebuild resumes from the pair's own last episode", async () => {
  const db = await database();
  disagreements(db, 2);
  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  // A later outage arrives; only it is new.
  samples(db, "acme-probe", "..xxx.", 60);
  samples(db, "acme", "......", 60);
  assert.equal(trust.rebuild([PAIR]), 1);
});

test("the card stays silent below the floor, and says how far below", async () => {
  const db = await database();
  disagreements(db, 3);
  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  const card = trust.card(PAIR, 3650, new Date(START + 100 * MINUTE));
  assert.ok("floor" in card);
  assert.equal(card.counted, 3);
  assert.equal(card.floor, EPISODE_FLOOR);
});

test("the card speaks once the window holds ten counted episodes", async () => {
  const db = await database();
  disagreements(db, EPISODE_FLOOR);
  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  const card = trust.card(PAIR, 3650, new Date(START + 200 * MINUTE));
  assert.ok(!("floor" in card));
  assert.equal(card.counted, EPISODE_FLOOR);
  assert.equal(card.never, EPISODE_FLOOR);
  // Never admitted anything, so there is no delay to report — and the absence
  // is a null rather than a zero, which would read as "admitted instantly".
  assert.equal(card.delay, null);
  assert.equal(card.coverage?.percent, 0);
});

test("the floor is applied inside the selected window, not against all of history", async () => {
  const db = await database();
  disagreements(db, EPISODE_FLOOR);
  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  // A window that starts after every episode holds none of them.
  const later = new Date(START + 400 * 24 * 60 * MINUTE);
  const card = trust.card(PAIR, 30, later);
  assert.ok("floor" in card);
  assert.equal(card.counted, 0);
});

test("a cycle in which every status page failed excludes the episode instead of accusing the page", async () => {
  const db = await database();
  // A second page, so the blindness vote has the two answers it asks for.
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run("other", "Other", "statuspage", "https://status.other.example", new Date(START).toISOString());

  samples(db, "acme-probe", "..xxx.");
  samples(db, "acme", "..!!!.");
  samples(db, "other", "..!!!.");

  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  const rows = trust.episodes(PAIR, 3650, new Date(START + 100 * MINUTE));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.excluded, "fleet_blind");
});

test("declared maintenance on the page excludes the episode", async () => {
  const db = await database();
  db.prepare(
    `INSERT INTO maintenances (provider_id, maintenance_id, name, status, starts_at, ends_at, component_ids, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(
    "acme",
    "m1",
    "Planned upgrade",
    "in_progress",
    new Date(START).toISOString(),
    new Date(START + 10 * MINUTE).toISOString(),
    new Date(START).toISOString(),
    new Date(START).toISOString(),
  );
  samples(db, "acme-probe", "..xxx.");
  samples(db, "acme", "......");

  const trust = createTrustService(db);
  trust.rebuild([PAIR]);
  const rows = trust.episodes(PAIR, 3650, new Date(START + 100 * MINUTE));
  assert.equal(rows[0]!.excluded, "maintenance");
  // Recorded, not dropped: the excluded count on the card has to be checkable.
  assert.equal(rows.length, 1);
});
