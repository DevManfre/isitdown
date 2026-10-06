import { test } from "node:test";
import assert from "node:assert/strict";
import { detectionDelayMinutes, detectionDelayOf } from "../../src/ui/history.ts";
import type { IncidentRow } from "../../src/ui/historyStore.interface.ts";

const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  providerId: "github",
  incidentId: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  startedAt: "2026-08-19T14:00:00.000Z",
  updatedAt: "2026-08-19T14:00:00.000Z",
  resolvedAt: null,
  ...over,
});

/** An incident declared at 14:00 and first carried `minutes` later. */
const seenAfter = (minutes: number, id = "i1"): IncidentRow =>
  row({
    incidentId: id,
    declaredAt: "2026-08-19T14:00:00.000Z",
    firstSeenAt: new Date(Date.parse("2026-08-19T14:00:00.000Z") + minutes * 60_000).toISOString(),
  });

test("the delay is from the provider's declaration to the poll that first carried it", () => {
  assert.equal(detectionDelayMinutes(seenAfter(4)), 4);
});

test("an incident missing either end has no delay rather than a zero one", () => {
  assert.equal(detectionDelayMinutes(row({ firstSeenAt: "2026-08-19T14:04:00.000Z" })), undefined);
  assert.equal(detectionDelayMinutes(row({ declaredAt: "2026-08-19T14:00:00.000Z" })), undefined);
  assert.equal(detectionDelayMinutes(row({ declaredAt: "not a date", firstSeenAt: "2026-08-19T14:04:00.000Z" })), undefined);
});

test("a provider clock ahead of ours reads as an instant detection, never a negative one", () => {
  const ahead = row({ declaredAt: "2026-08-19T14:06:00.000Z", firstSeenAt: "2026-08-19T14:04:00.000Z" });
  assert.equal(detectionDelayMinutes(ahead), 0);
});

const cases: { name: string; incidents: IncidentRow[]; expected: ReturnType<typeof detectionDelayOf> }[] = [
  { name: "nothing measurable", incidents: [row()], expected: null },
  { name: "one incident", incidents: [seenAfter(3)], expected: { medianMinutes: 3, worstMinutes: 3, measured: 1 } },
  {
    name: "an odd count takes the middle one",
    incidents: [seenAfter(11, "a"), seenAfter(2, "b"), seenAfter(4, "c")],
    expected: { medianMinutes: 4, worstMinutes: 11, measured: 3 },
  },
  {
    name: "an even count averages the middle two",
    incidents: [seenAfter(2, "a"), seenAfter(4, "b"), seenAfter(6, "c"), seenAfter(30, "d")],
    expected: { medianMinutes: 5, worstMinutes: 30, measured: 4 },
  },
  {
    name: "unmeasurable incidents are left out of the count",
    incidents: [seenAfter(3, "a"), row({ incidentId: "b" })],
    expected: { medianMinutes: 3, worstMinutes: 3, measured: 1 },
  },
];

for (const { name, incidents, expected } of cases) {
  test(`median and worst detection delay: ${name}`, () => {
    assert.deepEqual(detectionDelayOf(incidents), expected);
  });
}
