// test/ui/geo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGeoTables, resolveLocation, type GeoTables } from "../../src/ui/geo/resolveLocation.ts";

const tables: GeoTables = loadGeoTables();

test("an IATA code in parentheses at the end of the name resolves", () => {
  const point = resolveLocation("Amsterdam, Netherlands - (AMS)", tables);
  assert.ok(point, "AMS should resolve");
  assert.equal(point.source, "iata");
  // Schiphol, to a degree — the exact figure is the dataset's, not ours.
  assert.ok(Math.abs(point.lat - 52.31) < 1, `lat was ${point.lat}`);
  assert.ok(Math.abs(point.lon - 4.76) < 1, `lon was ${point.lon}`);
});

test("a cloud region code resolves", () => {
  const point = resolveLocation("EU (Frankfurt) eu-central-1", tables);
  assert.ok(point);
  assert.equal(point.source, "region");
});

test("a functional component resolves to null", () => {
  assert.equal(resolveLocation("Git Operations", tables), null);
  assert.equal(resolveLocation("Webhooks", tables), null);
});

test("a parenthesised three-letter word absent from the table resolves to null", () => {
  // The real guard, and the reason `resolveLocation` takes its tables as an
  // argument: the regex only produces a candidate, and a candidate the table
  // does not know is not a location. Asserted against a one-entry table so
  // this case cannot drift when OurAirports adds or retires a code.
  const only: GeoTables = { iata: { AMS: { lat: 52.31, lon: 4.76 } }, regions: {} };
  assert.equal(resolveLocation("Somewhere - (ZZZ)", only), null);
  assert.equal(resolveLocation("Amsterdam, Netherlands - (AMS)", only)?.source, "iata");
});

test("a parenthesised code with no separator before it is not a location", () => {
  // "Beta feature (NEW)" is prose, but NEW is a live IATA code (New Orleans
  // Lakefront) — so the table cannot be what rejects it. The separator
  // requirement is. Pinned here so a future loosening of the regex is a
  // deliberate act with a failing test to argue with, not a silent change.
  assert.equal(resolveLocation("Beta feature (NEW)", tables), null);
});

test("an IATA match is preferred over a region match in the same name", () => {
  const point = resolveLocation("eu-central-1 edge - (FRA)", tables);
  assert.ok(point);
  assert.equal(point.source, "iata");
});

test("loadGeoTables rejects a malformed table", () => {
  assert.throws(() => {
    // The zod guard is the point: a hand-edited JSON with a string latitude
    // must fail loudly at load, not silently place a dot at NaN.
    loadGeoTables({ iata: { AMS: { lat: "52.31", lon: 4.76 } }, regions: {} } as unknown as GeoTables);
  });
});

test("the committed Cloudflare fixture resolves at least 80% of its geographic components", () => {
  const raw = JSON.parse(
    readFileSync(new URL("../fixtures/cloudflare/summary.json", import.meta.url), "utf8"),
  ) as { components: { name?: string; group?: boolean }[] };

  const geographic = raw.components
    .filter((component) => component.group !== true)
    .map((component) => component.name ?? "")
    .filter((name) => /\([A-Z]{3}\)\s*$/.test(name));

  assert.ok(geographic.length >= 20, `fixture should carry geographic components, had ${geographic.length}`);
  const resolved = geographic.filter((name) => resolveLocation(name, tables) !== null).length;
  const rate = resolved / geographic.length;
  assert.ok(rate >= 0.8, `resolution rate was ${(rate * 100).toFixed(1)}% (${resolved}/${geographic.length})`);
});

test("the fixture's three known airports all resolve", () => {
  for (const code of ["AMS", "FRA", "LHR"]) {
    assert.ok(resolveLocation(`Somewhere - (${code})`, tables), `${code} should resolve`);
  }
});
