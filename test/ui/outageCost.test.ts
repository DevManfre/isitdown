import { test } from "node:test";
import assert from "node:assert/strict";
import { costRatesOf, downtimeCost, incidentCost } from "../../src/ui/outageCost.ts";
import type { IncidentRow } from "../../src/ui/historyStore.interface.ts";

const rates = costRatesOf([{ id: "github", outageCostPerHour: 1200 }, { id: "slack" }]);

const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  providerId: "github",
  incidentId: "i1",
  name: "Outage",
  impact: "major",
  status: "resolved",
  startedAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T11:30:00.000Z",
  resolvedAt: "2026-08-10T11:30:00.000Z",
  ...over,
});

test("only a provider with a declared rate has one", () => {
  assert.deepEqual([...rates.keys()], ["github"]);
});

test("downtime is priced by the hour, and an undeclared rate is null rather than free", () => {
  assert.equal(downtimeCost(rates, "github", 90), 1800);
  assert.equal(downtimeCost(rates, "github", 0), 0);
  assert.equal(downtimeCost(rates, "slack", 90), null);
});

test("a resolved incident is priced to its resolution, an open one to now", () => {
  assert.equal(incidentCost(rates, row(), Date.parse("2026-09-01T00:00:00.000Z")), 1800);
  const open = row({ resolvedAt: null, status: "investigating" });
  assert.equal(incidentCost(rates, open, Date.parse("2026-08-10T11:00:00.000Z")), 1200);
  assert.equal(incidentCost(rates, row({ providerId: "slack" }), 0), null);
});
