import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, inScope, scopeOf } from "../../src/adapters/scope.ts";

/**
 * Roadmap 2.8: the one rule the three hyperscaler adapters share — keep what
 * the fleet runs on, and never hide what the feed places nowhere.
 */

test("names compare with case, spaces and dashes folded away", () => {
  assert.equal(fold("West Europe"), fold("westeurope"));
  assert.equal(fold("eu-west-1"), "euwest1");
  assert.equal(fold("Compute Engine"), fold("compute-engine"));
});

test("no option, no narrowing", () => {
  const scope = scopeOf(undefined);
  assert.deepEqual(scope, { regions: null, services: null });
  assert.equal(inScope(scope, ["ap-south-1"], ["EC2"]), true);
  assert.deepEqual(scopeOf({ regions: " , " }), { regions: null, services: null }, "an empty list is no list");
});

test("the older single option is read only when the new one is absent", () => {
  assert.deepEqual([...scopeOf({ region: "eu-west-1" }, "region").regions!], ["euwest1"]);
  assert.deepEqual([...scopeOf({ region: "eu-west-1", regions: "us-east-1" }, "region").regions!], ["useast1"]);
  assert.equal(scopeOf({ region: "eu-west-1" }).regions, null, "not read unless the adapter names it");
});

test("what the scope keeps: a table", () => {
  const scope = scopeOf({ regions: "eu-west-1, westeurope", services: "EC2, Virtual Machines" });
  const cases: [string[], string[], boolean, string][] = [
    [["eu-west-1"], ["ec2"], true, "both match"],
    [["West Europe"], ["Virtual Machines"], true, "display names match API names"],
    [["us-east-1"], ["ec2"], false, "another region"],
    [["eu-west-1"], ["S3"], false, "another service"],
    [[], ["ec2"], true, "placed nowhere"],
    [["Global"], ["ec2"], true, "global"],
    [["Multiple Regions"], ["ec2"], true, "multiple regions"],
    [["eu-west-1"], [], true, "names no service"],
    [["eu-west-1"], ["Multiple services"], true, "multiple services"],
    [["us-east-1", "eu-west-1"], ["S3", "EC2"], true, "any one of several"],
  ];
  for (const [regions, services, kept, label] of cases) assert.equal(inScope(scope, regions, services), kept, label);
});
