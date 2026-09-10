import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../../src/adapters/catalog.ts";
import { adapters } from "../../src/adapters/index.ts";
import { serviceDefinitionSchema } from "../../src/core/config.schema.ts";

/**
 * The catalog exists to spare an operator three answers they cannot be expected
 * to know, so every entry has to be an answer the rest of the system accepts —
 * a bundled row that the service schema rejects would turn a menu pick into a
 * 400 nobody can act on. Nothing here reaches a provider: the list is checked
 * against the code that would consume it, not against the internet.
 */
test("every catalog entry is a service definition the schema accepts", () => {
  for (const entry of CATALOG) {
    const parsed = serviceDefinitionSchema.safeParse(entry);
    assert.equal(parsed.success, true, `${entry.id}: ${parsed.success ? "" : parsed.error.message}`);
  }
});

test("every catalog entry names an adapter the registry has", () => {
  const known = Object.keys(adapters);
  for (const entry of CATALOG) {
    assert.ok(known.includes(entry.adapter), `${entry.id} names unknown adapter ${entry.adapter}`);
  }
});

test("ids and base urls are unique, so no two rows are the same provider twice", () => {
  const ids = CATALOG.map((entry) => entry.id);
  const urls = CATALOG.map((entry) => entry.baseUrl);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  assert.equal(new Set(urls).size, urls.length, "duplicate base url");
});

test("no base url carries a trailing slash an adapter would double up", () => {
  for (const entry of CATALOG) {
    assert.doesNotMatch(entry.baseUrl, /\/$/, `${entry.id} ends in a slash`);
    assert.match(entry.baseUrl, /^https:\/\//, `${entry.id} is not https`);
  }
});
