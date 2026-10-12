import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG } from "../../src/adapters/catalog.ts";
import { detectImportTool, importMonitors, slugify, type ImportResult } from "../../src/adapters/import/index.ts";
import { goDurationSeconds } from "../../src/adapters/import/gatus.ts";
import { serviceDefinitionSchema } from "../../src/core/config.schema.ts";

/**
 * Roadmap 2.4: a neighbour tool's export, read into proposals. Each fixture
 * holds one of everything its importer has to decide about — a probe, a status
 * page the catalog knows, a job that calls in, and something with no
 * equivalent — and the tests hold every decision, not only the happy ones.
 */

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url), "utf8");

const read = (name: string): ImportResult => importMonitors(fixture(name), CATALOG);

const bySource = (result: ImportResult, source: string) => {
  const found = result.services.find((entry) => entry.source === source);
  assert.ok(found, `${source} was not proposed; skipped: ${JSON.stringify(result.skipped)}`);
  return found;
};

const skipOf = (result: ImportResult, source: string) => {
  const found = result.skipped.find((entry) => entry.source === source);
  assert.ok(found, `${source} was not skipped`);
  return found;
};

test("the tool is told apart by the shape of its file", () => {
  assert.equal(detectImportTool(fixture("uptimekuma-backup.json")), "uptimekuma");
  assert.equal(detectImportTool(fixture("gatus-config.yaml")), "gatus");
  assert.equal(detectImportTool(fixture("statping-export.json")), "statping");
  assert.equal(detectImportTool(fixture("statusgator-monitors.json")), "statusgator");
  assert.equal(detectImportTool('{"hello": "world"}'), null);
  assert.equal(detectImportTool("services:\n  - name: x\n"), null);
  assert.throws(() => importMonitors("just text", CATALOG), /not an Uptime Kuma backup/);
});

test("a file read as the wrong tool says which and why", () => {
  assert.throws(() => importMonitors(fixture("gatus-config.yaml"), CATALOG, "uptimekuma"), /cannot read this as a uptimekuma export/);
});

test("every proposal is a provider the schema accepts", () => {
  for (const name of ["uptimekuma-backup.json", "gatus-config.yaml", "statping-export.json", "statusgator-monitors.json"]) {
    for (const { service } of read(name).services) {
      assert.ok(serviceDefinitionSchema.safeParse(service).success, `${name}: ${JSON.stringify(service)}`);
    }
  }
});

test("Uptime Kuma: probes, a recognised status page, a push monitor and the rest", () => {
  const result = read("uptimekuma-backup.json");
  assert.equal(result.tool, "uptimekuma");

  assert.deepEqual(bySource(result, "API health").service, {
    id: "api-health",
    name: "API health",
    adapter: "http",
    baseUrl: "https://api.example.com/health",
    intervalSeconds: 30,
    options: { expectStatus: "200-299,304", expectBody: '"ok":true' },
    group: "infrastructure",
  });
  assert.deepEqual(bySource(result, "API health").notes, [{ code: "credentials-dropped" }]);

  const banner = bySource(result, "No maintenance banner").service;
  assert.equal(banner.enabled, false);
  assert.deepEqual(banner.options, { absentBody: "maintenance" });

  assert.deepEqual(bySource(result, "Postgres").service.options, { port: "5432" });
  assert.equal(bySource(result, "Postgres").service.adapter, "tcp");
  assert.deepEqual(bySource(result, "Mail MX").service.options, { recordType: "MX", resolver: "1.1.1.1" });

  const backup = bySource(result, "Nightly backup");
  assert.equal(backup.kind, "heartbeat");
  assert.deepEqual(backup.service.options, { every: "1d" });

  const github = bySource(result, "GitHub status");
  assert.equal(github.kind, "page");
  assert.equal(github.service.id, "github");
  assert.equal(github.service.adapter, "statuspage");

  assert.deepEqual(skipOf(result, "SRV record"), { source: "SRV record", type: "dns", reason: "unsupported-type", detail: "dns SRV" });
  assert.equal(skipOf(result, "Router").reason, "unsupported-type");
  assert.deepEqual(skipOf(result, "Webhook receiver"), {
    source: "Webhook receiver",
    type: "http",
    reason: "unsupported-method",
    detail: "POST",
  });
  // The group monitor is a group here, not a monitor nobody can import.
  assert.ok(!result.skipped.some((entry) => entry.source === "Infrastructure"));

  // Two monitors with the same name get two ids, and a HEAD probe keeps its method.
  const second = result.services.filter((entry) => entry.source === "Homepage").map((entry) => entry.service);
  assert.deepEqual(
    second.map((service) => service.id),
    ["homepage", "homepage-2"],
  );
  assert.deepEqual(second[1]!.options, { method: "HEAD" });
  assert.equal(second[1]!.intervalSeconds, 90);
  assert.equal(second[0]!.baseUrl, "https://example.com", "the trailing slash is normalised away");
});

test("Gatus: conditions translated where they mean the same, named where they do not", () => {
  const result = read("gatus-config.yaml");

  const website = bySource(result, "website");
  assert.deepEqual(website.service.options, {
    expectStatus: "200",
    expectBody: "Welcome",
    slowMs: "500",
    tlsWarnDays: "2",
  });
  assert.equal(website.service.intervalMinutes, 5);
  assert.equal(website.service.group, "core");
  assert.deepEqual(website.notes, [{ code: "slow-is-degraded" }]);

  const api = bySource(result, "api");
  assert.equal(api.service.intervalSeconds, 30);
  assert.equal(api.service.options, undefined, "[STATUS] >= 200 and < 300 is the default range");
  assert.deepEqual(api.notes, [
    { code: "conditions-dropped", detail: "[BODY].status == UP" },
    { code: "credentials-dropped" },
  ]);

  assert.deepEqual(bySource(result, "postgres").service.options, { port: "5432" });
  assert.deepEqual(bySource(result, "resolver").service, {
    id: "resolver",
    name: "resolver",
    adapter: "dns",
    baseUrl: "https://example.com",
    intervalMinutes: 1,
    options: { resolver: "8.8.8.8", expectValue: "93.184.216.34" },
  });
  assert.equal(bySource(result, "cloudflare").kind, "page");
  assert.equal(bySource(result, "disabled-one").service.enabled, false);
  assert.deepEqual(bySource(result, "disabled-one").service.options, { expectStatus: "200,301" });

  const backup = bySource(result, "backup-job");
  assert.equal(backup.kind, "heartbeat");
  assert.deepEqual(backup.service.options, { every: "1d" });
  assert.equal(backup.service.group, "jobs");

  assert.equal(skipOf(result, "ping-router").reason, "unsupported-type");
  assert.equal(skipOf(result, "create-order").reason, "unsupported-method");
  assert.equal(skipOf(result, "ad-hoc").reason, "no-interval");
});

test("Gatus durations read the way Go writes them", () => {
  assert.equal(goDurationSeconds("30s"), 30);
  assert.equal(goDurationSeconds("5m"), 300);
  assert.equal(goDurationSeconds("1h30m"), 5400);
  assert.equal(goDurationSeconds("48h"), 172_800);
  assert.equal(goDurationSeconds("10ms"), undefined);
  assert.equal(goDurationSeconds(""), undefined);
});

test("Statping: services become probes, check-ins become heartbeats", () => {
  const result = read("statping-export.json");

  const google = bySource(result, "Google");
  assert.equal(google.service.intervalSeconds, 10);
  assert.equal(google.service.group, "web-sites");
  assert.deepEqual(google.service.options, { expectStatus: "200" });

  const status = bySource(result, "Status JSON");
  assert.equal(status.service.options?.["expectBody"], undefined, "a regular expression is not a substring");
  assert.deepEqual(status.notes, [{ code: "credentials-dropped" }, { code: "body-pattern-dropped", detail: "(online|ok)" }]);

  assert.equal(bySource(result, "Plain body").service.options?.["expectBody"], "Example Domain");
  assert.deepEqual(bySource(result, "SSH").service.options, { port: "22" });

  const sync = bySource(result, "Hourly sync");
  assert.equal(sync.kind, "heartbeat");
  assert.deepEqual(sync.service.options, { every: "1h" });

  assert.equal(skipOf(result, "DNS UDP").reason, "unsupported-type");
  assert.equal(skipOf(result, "Submit form").reason, "unsupported-method");
  assert.equal(skipOf(result, "Broken check-in").reason, "no-interval");
});

test("StatusGator: a status page the catalog knows is that provider, one it does not is reported", () => {
  const result = read("statusgator-monitors.json");

  const cloudflare = bySource(result, "Cloudflare");
  assert.equal(cloudflare.kind, "page");
  assert.deepEqual(cloudflare.service, {
    id: "cloudflare",
    name: "Cloudflare",
    adapter: "statuspage",
    baseUrl: "https://www.cloudflarestatus.com",
    group: "infrastructure",
  });
  assert.equal(bySource(result, "OpenAI").service.enabled, false, "a paused monitor arrives disabled");
  assert.equal(bySource(result, "Our shop").service.adapter, "http");

  assert.deepEqual(skipOf(result, "Some Niche SaaS"), {
    source: "Some Niche SaaS",
    type: "ServiceMonitor",
    reason: "page-not-in-catalog",
    detail: "https://status.niche-saas.example",
  });
  assert.equal(skipOf(result, "Landing page").reason, "invalid");
  assert.equal(skipOf(result, "Edge box").reason, "unsupported-type");
});

test("the same catalog provider watched twice is proposed once", () => {
  const content = JSON.stringify({
    data: [
      { monitor_type: "ServiceMonitor", display_name: "GitHub", service: { status_page_url: "https://www.githubstatus.com" } },
      { monitor_type: "ServiceMonitor", display_name: "GitHub again", service: { status_page_url: "https://githubstatus.com/" } },
    ],
  });
  const result = importMonitors(content, CATALOG);
  assert.equal(result.services.length, 1);
  assert.deepEqual(skipOf(result, "GitHub again"), { source: "GitHub again", type: "ServiceMonitor", reason: "duplicate", detail: "github" });
});

test("cadences outside what a probe or a heartbeat takes are clamped, and say so", () => {
  const result = importMonitors(
    JSON.stringify({
      monitorList: [
        { id: 1, name: "fast", type: "http", url: "https://a.example", interval: 5 },
        { id: 2, name: "push fast", type: "push", interval: 20 },
      ],
    }),
    CATALOG,
  );
  assert.equal(bySource(result, "fast").service.intervalSeconds, 10);
  assert.deepEqual(bySource(result, "fast").notes, [{ code: "cadence-raised", detail: "5s → 10s" }]);
  assert.deepEqual(bySource(result, "push fast").service.options, { every: "1m" });
  assert.deepEqual(bySource(result, "push fast").notes, [{ code: "cadence-raised", detail: "20s → 1m" }]);
});

test("a monitor name becomes a provider slug", () => {
  assert.equal(slugify("Mail server (EU)"), "mail-server-eu");
  assert.equal(slugify("Café — Ünïcode"), "cafe-unicode");
  assert.equal(slugify("!!!"), "monitor");
});
