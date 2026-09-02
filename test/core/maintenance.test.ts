import { test } from "node:test";
import assert from "node:assert/strict";
import { activeWindows, isActive } from "../../src/core/maintenance.ts";
import type { MaintenanceWindow, NormalizedStatus } from "../../src/core/types.ts";

const window = (over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  id: "m1",
  name: "Database upgrade",
  status: "scheduled",
  startsAt: "2026-09-02T01:00:00.000Z",
  endsAt: "2026-09-02T03:00:00.000Z",
  componentIds: [],
  ...over,
});

const cases: { name: string; window: MaintenanceWindow; at: string; expected: boolean }[] = [
  { name: "before start not active", window: window(), at: "2026-09-02T00:59:00.000Z", expected: false },
  { name: "inside declared window is active", window: window(), at: "2026-09-02T02:00:00.000Z", expected: true },
  { name: "at exact end is over", window: window(), at: "2026-09-02T03:00:00.000Z", expected: false },
  { name: "after end not active", window: window(), at: "2026-09-02T04:00:00.000Z", expected: false },
  {
    name: "no declared end, in_progress lifecycle is active",
    window: window({ endsAt: null, status: "in_progress" }),
    at: "2026-09-05T00:00:00.000Z",
    expected: true,
  },
  {
    name: "no declared end, verifying lifecycle is active",
    window: window({ endsAt: null, status: "verifying" }),
    at: "2026-09-05T00:00:00.000Z",
    expected: true,
  },
  {
    name: "no declared end, scheduled lifecycle not active",
    window: window({ endsAt: null, status: "scheduled" }),
    at: "2026-09-05T00:00:00.000Z",
    expected: false,
  },
  {
    name: "no declared end, before start not active regardless of lifecycle",
    window: window({ endsAt: null, status: "in_progress" }),
    at: "2026-09-02T00:00:00.000Z",
    expected: false,
  },
  {
    name: "unparseable at is not active",
    window: window(),
    at: "not-a-date",
    expected: false,
  },
  {
    name: "unparseable startsAt is not active",
    window: window({ startsAt: "not-a-date" }),
    at: "2026-09-02T02:00:00.000Z",
    expected: false,
  },
  {
    name: "declared endsAt unparseable does not fall back to the lifecycle word",
    window: window({ endsAt: "not-a-date", status: "in_progress" }),
    at: "2026-09-02T02:00:00.000Z",
    expected: false,
  },
];

for (const row of cases) {
  test(`isActive: ${row.name}`, () => {
    assert.equal(isActive(row.window, row.at), row.expected);
  });
}

test("activeWindows reads status against its own fetch time", () => {
  const status: NormalizedStatus = {
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [],
    maintenances: [window(), window({ id: "m2", startsAt: "2026-09-09T01:00:00.000Z" })],
    fetchedAt: "2026-09-02T02:00:00.000Z",
  };

  assert.deepEqual(
    activeWindows(status).map((entry) => entry.id),
    ["m1"],
  );
});
