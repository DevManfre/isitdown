import { test } from "node:test";
import assert from "node:assert/strict";
import { closed, contract } from "../helpers/openapiContract.ts";

/**
 * The contract check rides along every API test (`--import`), so its own
 * failure mode is to pass everything quietly. These pin that it does not.
 */

const lookup = contract();

const validate = (path: string, method: string, status: number) => {
  const found = lookup(path, method, status);
  assert.equal(typeof found, "function", `${method} ${path} ${status}: ${String(found)}`);
  return found as (body: unknown) => boolean;
};

test("a field the spec does not document fails, even on a schema that does not close itself", () => {
  const health = validate("/health", "GET", 200);
  assert.equal(health({ status: "ok", providers: 3, lastCycleAt: null }), true);
  assert.equal(health({ status: "ok", providers: 3, lastCycleAt: null, undocumented: 1 }), false);
});

test("a field the spec documents with the wrong type fails", () => {
  const health = validate("/health", "GET", 200);
  assert.equal(health({ status: "ok", providers: "three", lastCycleAt: null }), false);
});

test("a nested field is held to the same rule as a top-level one", () => {
  const status = validate("/status", "GET", 200);
  const body = {
    providers: [],
    groups: [{ id: "g", providers: [], status: "operational", affected: [], extra: true }],
    pollIntervalMinutes: 5,
    lastPollAt: null,
    nextPollAt: null,
    serverNow: new Date().toISOString(),
  };
  assert.equal(status(body), false);
});

test("an undocumented status or operation is reported, not skipped", () => {
  assert.equal(typeof lookup("/health", "GET", 418), "string");
  assert.equal(typeof lookup("/nowhere", "GET", 200), "string");
});

test("an object that declares itself an open map stays open", () => {
  const schema = closed({ type: "object", additionalProperties: { type: "integer" } }) as Record<string, unknown>;
  assert.equal("unevaluatedProperties" in schema, false);
  const properties = closed({ type: "object", properties: { type: { type: "string" } } }) as Record<string, unknown>;
  // A property called `type` is a name, not a keyword: it must not be closed as if it were.
  assert.deepEqual((properties["properties"] as Record<string, unknown>)["type"], { type: "string" });
  assert.equal(properties["unevaluatedProperties"], false);
});
