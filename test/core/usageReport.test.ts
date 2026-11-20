import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverySchema, pollingSchema } from "../../src/core/config.schema.ts";
import type { RuntimeConfig, ServiceDefinition } from "../../src/core/configSource.interface.ts";
import { CATCH_ALL_RULE } from "../../src/core/routing.ts";
import { buildUsageReport } from "../../src/core/usageReport.ts";

const service = (id: string, adapter: string, enabled = true): ServiceDefinition =>
  ({ id, name: `Secret ${id}`, adapter, baseUrl: `https://${id}.internal.example`, enabled, components: [], scopeToComponents: false }) as ServiceDefinition;

const config = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  polling: pollingSchema.parse({}),
  locale: "en",
  services: [service("a", "statuspage"), service("b", "http"), service("c", "statuspage"), service("d", "tcp", false)],
  channels: [
    { id: "telegram", enabled: true },
    { id: "webhook", enabled: false },
    { id: "discord", enabled: true },
  ] as RuntimeConfig["channels"],
  rules: [CATCH_ALL_RULE],
  delivery: deliverySchema.parse({ quietHours: { enabled: true }, updateInPlace: true }),
  recipients: [],
  ...over,
});

test("counts enabled providers by adapter, enabled channels and switched-on delivery features", () => {
  const report = buildUsageReport({ edition: "light", version: "9.9.9", config: config() });
  assert.deepEqual(report, {
    edition: "light",
    version: "9.9.9",
    providers: { total: 4, enabled: 3, byAdapter: { http: 1, statuspage: 2 } },
    channels: ["discord", "telegram"],
    delivery: ["quietHours", "updateInPlace"],
    routingRules: 0,
    recipients: 0,
    features: {},
    deprecatedInUse: [],
  });
});

test("counts disabled providers the edition's config leaves out", () => {
  const report = buildUsageReport({
    edition: "ui",
    version: "1.0.0",
    config: config({ services: [service("a", "http")] }),
    allServices: [{ enabled: true }, { enabled: false }, { enabled: false }],
  });
  assert.deepEqual(report.providers, { total: 3, enabled: 1, byAdapter: { http: 1 } });
});

test("names nothing: no provider name, id or url survives into the report", () => {
  const text = JSON.stringify(buildUsageReport({ edition: "ui", version: "1.0.0", config: config() }));
  assert.doesNotMatch(text, /Secret|internal\.example|"a"|"b"/);
});

test("written routing rules are counted, the substituted catch-all is not; extras are sorted and deduplicated", () => {
  const rule = { provider: "a", classes: CATCH_ALL_RULE.classes, minSeverity: "any", channels: ["telegram"] } as RuntimeConfig["rules"][number];
  const report = buildUsageReport({
    edition: "ui",
    version: "1.0.0",
    config: config({ rules: [rule, CATCH_ALL_RULE] }),
    features: { push: true, apiToken: false },
    deprecatedInUse: ["/export/trust.csv", "/export/history.json", "/export/trust.csv"],
  });
  assert.equal(report.routingRules, 1);
  assert.deepEqual(Object.keys(report.features), ["apiToken", "push"]);
  assert.deepEqual(report.deprecatedInUse, ["/export/history.json", "/export/trust.csv"]);
});
