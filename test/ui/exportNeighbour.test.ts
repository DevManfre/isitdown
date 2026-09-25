import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { insertService, writeSettings } from "../../src/ui/dbConfigSource.ts";
import { exportGatusYaml } from "../../src/ui/exportNeighbour.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";

const silent = createLogger("error", () => {});

async function freshDb(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-gatus-export-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  return db;
}

const service = (over: Partial<ServiceDefinition> & Pick<ServiceDefinition, "id" | "adapter">): ServiceDefinition => ({
  name: over.id,
  baseUrl: "https://example.com",
  enabled: true,
  components: [],
  scopeToComponents: false,
  ...over,
});

/**
 * A minimal, offline re-statement of Gatus's own `Endpoint.ValidateAndSetDefaults`
 * (github.com/TwiN/gatus, `config/endpoint/endpoint.go` and
 * `config/endpoint/dns/dns.go`) — no network call and no Go toolchain available
 * in this sandbox, so this is the closest offline stand-in for "parsed by
 * Gatus itself": the same required fields, the same condition grammar
 * (`ErrInvalidConditionFormat`: `'<VALUE> <COMPARATOR> <VALUE>'`), and the same
 * DNS query-type allowlist.
 */
const DNS_QUERY_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "NS", "TXT"]);
const CONDITION_FORMAT = /^\S.*\s(==|!=|<=|>=|<|>)\s\S.*$/;

function assertValidGatusEndpoint(endpoint: Record<string, unknown>): void {
  assert.equal(typeof endpoint["name"], "string");
  assert.ok((endpoint["name"] as string).length > 0, "name must not be empty");
  assert.equal(typeof endpoint["url"], "string");
  assert.ok((endpoint["url"] as string).length > 0, "url must not be empty");
  assert.ok(Array.isArray(endpoint["conditions"]), "conditions must be a list");
  assert.ok((endpoint["conditions"] as unknown[]).length > 0, "at least one condition is required");
  for (const condition of endpoint["conditions"] as unknown[]) {
    assert.equal(typeof condition, "string");
    assert.match(condition as string, CONDITION_FORMAT, `"${condition}" must match '<VALUE> <COMPARATOR> <VALUE>'`);
  }
  if (endpoint["dns"] !== undefined) {
    const dns = endpoint["dns"] as Record<string, unknown>;
    assert.equal(typeof dns["query-name"], "string");
    assert.ok((dns["query-name"] as string).length > 0, "dns.query-name is required");
    assert.ok(DNS_QUERY_TYPES.has(dns["query-type"] as string), `unknown DNS query-type "${dns["query-type"]}"`);
  }
  if (endpoint["interval"] !== undefined) {
    assert.match(endpoint["interval"] as string, /^\d+[smh]$/, "interval must be a Go duration string");
  }
}

test("an http probe translates to an endpoint Gatus itself accepts", async () => {
  const db = await freshDb();
  insertService(
    db,
    service({
      id: "web",
      adapter: "http",
      name: "Web",
      baseUrl: "https://app.example.com",
      group: "core",
      intervalMinutes: 5,
      options: { path: "/health", expectStatus: "200-204", expectBody: "ok", slowMs: "800" },
    }),
  );

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 1);
  const endpoint = doc.endpoints[0]!;
  assertValidGatusEndpoint(endpoint);
  assert.equal(endpoint["name"], "Web");
  assert.equal(endpoint["group"], "core");
  assert.equal(endpoint["url"], "https://app.example.com/health");
  assert.equal(endpoint["interval"], "5m");
  assert.deepEqual(endpoint["conditions"], [
    "[STATUS] >= 200",
    "[STATUS] <= 204",
    "[BODY] == pat(*ok*)",
    "[RESPONSE_TIME] < 800",
  ]);
  db.close();
});

test("a tcp probe translates to a tcp:// endpoint with a CONNECTED condition", async () => {
  const db = await freshDb();
  insertService(
    db,
    service({
      id: "db",
      adapter: "tcp",
      baseUrl: "https://db.internal.example.com",
      options: { port: "5432", slowMs: "250" },
    }),
  );

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 1);
  const endpoint = doc.endpoints[0]!;
  assertValidGatusEndpoint(endpoint);
  assert.equal(endpoint["url"], "tcp://db.internal.example.com:5432");
  assert.deepEqual(endpoint["conditions"], ["[CONNECTED] == true", "[RESPONSE_TIME] < 250"]);
  db.close();
});

test("a dns probe with an explicit resolver translates to a dns endpoint", async () => {
  const db = await freshDb();
  insertService(
    db,
    service({
      id: "resolution",
      adapter: "dns",
      baseUrl: "https://example.com",
      options: { recordType: "A", expectValue: "93.184.215.14", resolver: "1.1.1.1" },
    }),
  );

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 1);
  const endpoint = doc.endpoints[0]!;
  assertValidGatusEndpoint(endpoint);
  assert.equal(endpoint["url"], "1.1.1.1");
  assert.deepEqual(endpoint["dns"], { "query-name": "example.com", "query-type": "A" });
  assert.deepEqual(endpoint["conditions"], ["[DNS_RCODE] == NOERROR", "[BODY] == pat(*93.184.215.14*)"]);
  db.close();
});

test("a dns probe left on the system resolver is skipped rather than guessed", async () => {
  const db = await freshDb();
  insertService(db, service({ id: "resolution", adapter: "dns", baseUrl: "https://example.com" }));

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 0);
  assert.match(yaml, /dns probe\(s\) with no explicit resolver/);
  db.close();
});

test("a status-page adapter has no Gatus equivalent, is skipped and counted in the header", async () => {
  const db = await freshDb();
  insertService(db, service({ id: "github", adapter: "statuspage", baseUrl: "https://www.githubstatus.com" }));
  insertService(db, service({ id: "cloudflare", adapter: "statuspage", baseUrl: "https://www.cloudflarestatus.com" }));
  insertService(db, service({ id: "web", adapter: "http", baseUrl: "https://app.example.com" }));

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 1);
  assert.equal(doc.endpoints[0]!["name"], "web");
  assert.match(yaml, /# {3}- statuspage: 2 service\(s\)/);
  db.close();
});

test("a disabled service is included with enabled: false, and the header says so", async () => {
  const db = await freshDb();
  insertService(db, service({ id: "web", adapter: "http", baseUrl: "https://app.example.com", enabled: false }));

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints.length, 1);
  assert.equal(doc.endpoints[0]!["enabled"], false);
  assert.match(yaml, /disabled provider is included/);
  db.close();
});

test("the global poll interval is used when a service sets no interval of its own", async () => {
  const db = await freshDb();
  writeSettings(db, { pollIntervalMinutes: 7 });
  insertService(db, service({ id: "web", adapter: "http", baseUrl: "https://app.example.com" }));

  const yaml = exportGatusYaml(db, silent);
  const doc = parse(yaml) as { endpoints: Record<string, unknown>[] };

  assert.equal(doc.endpoints[0]!["interval"], "7m");
  db.close();
});

test("no credential value, resolved or referenced, ever reaches the file", async () => {
  const db = await freshDb();
  insertService(
    db,
    service({
      id: "web",
      adapter: "http",
      baseUrl: "https://app.example.com",
      options: { "header.Authorization": "${API_TOKEN}", expectBody: "ok" },
    }),
  );

  const previous = process.env["API_TOKEN"];
  process.env["API_TOKEN"] = "super-secret-value";
  try {
    const yaml = exportGatusYaml(db, silent);
    assert.doesNotMatch(yaml, /super-secret-value/, "the resolved secret must never reach the file");
    assert.doesNotMatch(yaml, /API_TOKEN/, "not even the reference: headers are not translated at all");
  } finally {
    if (previous === undefined) delete process.env["API_TOKEN"];
    else process.env["API_TOKEN"] = previous;
  }
  db.close();
});
