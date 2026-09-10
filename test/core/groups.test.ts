import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGroups } from "../../src/core/groups.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { OverallStatus } from "../../src/core/types.ts";

const service = (id: string, over: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: `https://status.${id}.test`,
  enabled: true,
  components: [],
  scopeToComponents: false,
  ...over,
});

const readings = (map: Record<string, OverallStatus>) => (id: string): OverallStatus => map[id] ?? "unknown";

test("a group's status is its worst member", () => {
  const groups = deriveGroups(
    [
      service("github", { group: "deploy-path" }),
      service("vercel", { group: "deploy-path" }),
      service("stripe", { group: "billing" }),
    ],
    readings({ github: "operational", vercel: "partial_outage", stripe: "operational" }),
  );

  assert.deepEqual(
    groups.map((group) => [group.id, group.status]),
    [
      ["billing", "operational"],
      ["deploy-path", "partial_outage"],
    ],
  );
});

test("the affected list names the members that are not fine, worst first", () => {
  const [group] = deriveGroups(
    [
      service("a", { group: "stack" }),
      service("b", { group: "stack" }),
      service("c", { group: "stack" }),
      service("d", { group: "stack" }),
    ],
    readings({ a: "degraded", b: "operational", c: "major_outage", d: "unknown" }),
  );

  assert.equal(group?.status, "major_outage");
  // `d` has no reading, so it is not "affected" — it is unmeasured.
  assert.deepEqual(group?.affected, ["c", "a"]);
});

test("an unread provider cannot hold a group at unknown", () => {
  const [group] = deriveGroups(
    [service("a", { group: "stack" }), service("b", { group: "stack" })],
    readings({ a: "operational" }),
  );

  assert.equal(group?.status, "operational", "one silent member does not make a healthy stack unknown");
});

test("a group nothing has been read from is unknown, not operational", () => {
  const [group] = deriveGroups([service("a", { group: "stack" })], readings({}));

  assert.equal(group?.status, "unknown");
});

test("a disabled provider leaves its group, and an all-disabled group disappears", () => {
  const groups = deriveGroups(
    [
      service("a", { group: "stack" }),
      service("b", { group: "stack", enabled: false }),
      service("c", { group: "retired", enabled: false }),
    ],
    readings({ a: "operational", b: "major_outage", c: "major_outage" }),
  );

  assert.deepEqual(
    groups.map((group) => [group.id, group.status, group.providers]),
    [["stack", "operational", ["a"]]],
    "a provider nobody polls cannot make a group unhealthy",
  );
});

test("a provider in no group is in no group: the fleet stays flat until asked", () => {
  assert.deepEqual(deriveGroups([service("a"), service("b")], readings({ a: "major_outage" })), []);
});
