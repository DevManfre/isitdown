import { test } from "node:test";
import assert from "node:assert/strict";
import { authorityOf, defaultAuthorityFor } from "../../src/core/authority.ts";
import { silentOutage } from "../../src/core/diffEngine.ts";
import { adapters } from "../../src/adapters/index.ts";

/**
 * The decision of roadmap 9.1, asserted: IsItDown is an aggregator *and* a
 * monitor, and every provider says which of the two answers for it.
 */

test("a probe answers for itself, a status page answers for its provider", () => {
  assert.equal(defaultAuthorityFor({ kind: "probe" }), "observed");
  assert.equal(defaultAuthorityFor({ kind: "page" }), "declared");
  // An adapter that says nothing reads somebody's page, which is what every
  // adapter but three is and what an external plugin almost certainly is.
  assert.equal(defaultAuthorityFor({}), "declared");
});

test("the three probes this build ships are the only ones that are not pages", () => {
  const probes = Object.values(adapters)
    .filter((adapter) => adapter.kind === "probe")
    .map((adapter) => adapter.id)
    .sort();
  assert.deepEqual(probes, ["dns", "http", "tcp"]);
});

test("an operator's own answer wins over the adapter's", () => {
  assert.equal(authorityOf({}, { kind: "probe" }), "observed");
  // A probe whose reading the operator does not want treated as the record.
  assert.equal(authorityOf({ authority: "declared" }, { kind: "probe" }), "declared");
  // A status page the operator has decided is an opinion.
  assert.equal(authorityOf({ authority: "observed" }, { kind: "page" }), "observed");
});

test("the silent-outage alert carries the authority, so the message can say what it means", () => {
  const inputs = {
    probe: { id: "api-probe", status: "major_outage" as const, note: "connection refused" },
    at: "2026-08-20T18:00:00.000Z",
  };

  const declared = silentOutage({
    ...inputs,
    page: { id: "acme", status: "operational", openIncidents: 0, authority: "declared" as const },
  });
  assert.equal(declared?.crossCheck?.authority, "declared");

  const observed = silentOutage({
    ...inputs,
    page: { id: "acme", status: "operational", openIncidents: 0, authority: "observed" as const },
  });
  assert.equal(observed?.crossCheck?.authority, "observed");

  // Either way the disagreement is still reported: authority decides what the
  // alert *says*, never whether there is one.
  assert.equal(declared?.kind, "silent_outage");
  assert.equal(observed?.kind, "silent_outage");
  assert.equal(declared?.providerId, "acme");
});
