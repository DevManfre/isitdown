import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { CATALOG } from "../../src/adapters/catalog.ts";
import { importMonitors } from "../../src/adapters/import/index.ts";
import { main, renderText, renderYaml } from "../../src/cli/import/run.ts";
import { serviceDefinitionSchema } from "../../src/core/config.schema.ts";

/**
 * `isitdown import` — roadmap 2.4. What the operator reads before adding
 * anything, and the `config.yml` block it hands the Light edition, which must
 * load: a heartbeat in it would make the whole file refuse to.
 */

const path = (name: string): string => fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
const read = (name: string) => importMonitors(readFileSync(path(name), "utf8"), CATALOG);

test("the report says what each monitor becomes, and what did not make it", () => {
  const text = renderText(read("uptimekuma-backup.json"));
  assert.match(text, /^Read an export from Uptime Kuma — monitors: 11\./);
  assert.match(text, /Proposed providers: 8 \(probes: 6, status pages: 1, heartbeats: 1\)\. Not imported: 3\./);
  assert.match(text, /Status pages the catalog recognises\n {2}GitHub status → github \(statuspage\)/);
  assert.match(text, /Heartbeats — .*UI edition\n {2}Nightly backup → nightly-backup \(heartbeat\)/);
  assert.match(text, /API health: headers, authentication or a request body left out/);
  assert.match(text, /Webhook receiver \(http\): a probe only repeats GET or HEAD — POST/);
});

test("the config.yml block leaves heartbeats out and says so, and every entry loads", () => {
  const yaml = renderYaml(read("gatus-config.yaml"));
  assert.match(yaml, /^# 1 heartbeat\(s\) left out: the Light edition has no URL a job can call\./);
  const services = (parse(yaml) as { services: unknown[] }).services;
  assert.ok(services.length > 0);
  for (const service of services) {
    const parsed = serviceDefinitionSchema.safeParse(service);
    assert.ok(parsed.success, JSON.stringify(service));
    assert.notEqual(parsed.data.adapter, "heartbeat");
  }
});

test("a block with no heartbeat carries no comment", () => {
  assert.doesNotMatch(renderYaml(read("statusgator-monitors.json")), /^#/);
});

test("the command refuses what it cannot do, with the exit code that says so", () => {
  const silence = (fn: () => number): number => {
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      return fn();
    } finally {
      process.stderr.write = write;
    }
  };
  assert.equal(silence(() => main([])), 2, "no file");
  assert.equal(silence(() => main([path("gatus-config.yaml"), path("statping-export.json")])), 2, "two files");
  assert.equal(silence(() => main([path("gatus-config.yaml"), "--from", "nagios"])), 2, "unknown tool");
  assert.equal(silence(() => main([path("gatus-config.yaml"), "--from"])), 2, "--from without a value");
  assert.equal(silence(() => main([path("gatus-config.yaml"), "--from", "statping"])), 1, "the wrong tool named");
  assert.equal(silence(() => main(["does-not-exist.json"])), 1, "a missing file");
});
