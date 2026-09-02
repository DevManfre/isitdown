import { test } from "node:test";
import assert from "node:assert/strict";
import { diff } from "../../src/core/diffEngine.ts";
import type {
  ComponentStatus,
  Incident,
  MaintenanceWindow,
  NormalizedStatus,
  OverallStatus,
  StatusChangeKind,
} from "../../src/core/types.ts";

const inc = (over: Partial<Incident> = {}): Incident => ({
  id: "i1",
  name: "API errors",
  impact: "minor",
  status: "investigating",
  updatedAt: "2026-08-19T14:00:00.000Z",
  ...over,
});

const snap = (
  overallStatus: OverallStatus,
  activeIncidents: Incident[] = [],
  components: ComponentStatus[] = [],
  maintenances: MaintenanceWindow[] = [],
): NormalizedStatus => ({
  provider: "github",
  overallStatus,
  activeIncidents,
  components,
  maintenances,
  fetchedAt: "2026-08-19T14:05:00.000Z",
});

const comp = (over: Partial<ComponentStatus> = {}): ComponentStatus => ({
  id: "c1",
  name: "Actions",
  status: "operational",
  ...over,
});

const window = (over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  id: "mw1",
  name: "Scheduled database upgrade",
  status: "in_progress",
  startsAt: "2026-08-19T14:00:00.000Z",
  endsAt: "2026-08-19T15:00:00.000Z",
  componentIds: [],
  ...over,
});

const running = window();
const windowA = window({ id: "mwA" });
const windowB = window({ id: "mwB" });

const cases: {
  name: string;
  previous: NormalizedStatus | null;
  next: NormalizedStatus;
  expect: StatusChangeKind[];
}[] = [
  {
    name: "first ever poll never notifies",
    previous: null,
    next: snap("major_outage", [inc()]),
    expect: [],
  },
  { name: "no change at all", previous: snap("operational"), next: snap("operational"), expect: [] },
  {
    name: "operational to degraded",
    previous: snap("operational"),
    next: snap("degraded"),
    expect: ["status_change"],
  },
  {
    name: "severity escalation degraded to major_outage",
    previous: snap("degraded"),
    next: snap("major_outage"),
    expect: ["status_change"],
  },
  {
    name: "recovery to operational resolves the open incident",
    previous: snap("major_outage", [inc()]),
    next: snap("operational"),
    expect: ["status_change", "incident_resolved"],
  },
  {
    name: "a new incident appears alongside the status change",
    previous: snap("operational"),
    next: snap("degraded", [inc()]),
    expect: ["status_change", "incident_opened"],
  },
  {
    name: "an existing incident changes its status field",
    previous: snap("major_outage", [inc({ status: "investigating" })]),
    next: snap("major_outage", [inc({ status: "monitoring" })]),
    expect: ["incident_updated"],
  },
  {
    name: "an existing incident escalates its impact",
    previous: snap("degraded", [inc({ impact: "minor" })]),
    next: snap("degraded", [inc({ impact: "critical" })]),
    expect: ["incident_updated"],
  },
  {
    name: "only updatedAt moved — a timestamp bump is not an event",
    previous: snap("degraded", [inc({ updatedAt: "2026-08-19T14:00:00.000Z" })]),
    next: snap("degraded", [inc({ updatedAt: "2026-08-19T14:04:00.000Z" })]),
    expect: [],
  },
  {
    name: "only the incident name was reworded",
    previous: snap("degraded", [inc({ name: "API errors" })]),
    next: snap("degraded", [inc({ name: "Elevated API errors" })]),
    expect: [],
  },
  {
    name: "the same incidents arrive in a different order",
    previous: snap("degraded", [inc({ id: "a" }), inc({ id: "b" })]),
    next: snap("degraded", [inc({ id: "b" }), inc({ id: "a" })]),
    expect: [],
  },
  {
    name: "unknown as previous never produces a status change",
    previous: snap("unknown"),
    next: snap("operational"),
    expect: [],
  },
  {
    name: "unknown as next never produces a status change",
    previous: snap("operational"),
    next: snap("unknown"),
    expect: [],
  },
  {
    name: "unknown as previous still reports a genuinely new incident",
    previous: snap("unknown"),
    next: snap("unknown", [inc()]),
    expect: ["incident_opened"],
  },
  {
    name: "two new incidents produce one change each",
    previous: snap("operational"),
    next: snap("major_outage", [inc({ id: "a" }), inc({ id: "b" })]),
    expect: ["status_change", "incident_opened", "incident_opened"],
  },
  {
    name: "one incident opens while another resolves",
    previous: snap("degraded", [inc({ id: "old" })]),
    next: snap("degraded", [inc({ id: "new" })]),
    expect: ["incident_opened", "incident_resolved"],
  },
  {
    name: "a component degrading is a component change",
    previous: snap("operational", [], [comp()]),
    next: snap("operational", [], [comp({ status: "degraded" })]),
    expect: ["component_status_change"],
  },
  {
    name: "a component recovering is a component change",
    previous: snap("operational", [], [comp({ status: "major_outage" })]),
    next: snap("operational", [], [comp()]),
    expect: ["component_status_change"],
  },
  {
    name: "a newly selected component is a baseline, not news",
    previous: snap("operational"),
    next: snap("operational", [], [comp({ status: "major_outage" })]),
    expect: [],
  },
  {
    name: "a component disappearing is silent",
    previous: snap("operational", [], [comp()]),
    next: snap("operational"),
    expect: [],
  },
  {
    name: "unknown on either side of a component is not comparable",
    previous: snap("operational", [], [comp({ status: "unknown" })]),
    next: snap("operational", [], [comp({ status: "major_outage" })]),
    expect: [],
  },
  {
    name: "an overall change and a component change report together",
    previous: snap("operational", [], [comp()]),
    next: snap("degraded", [], [comp({ status: "degraded" })]),
    expect: ["status_change", "component_status_change"],
  },
  {
    // Cloudflare's own fixture shows overlapping windows are the normal
    // shape, not an edge case: one ends mid-cycle while another keeps
    // running. Only the one that ended is news.
    name: "one window ends while another stays active — only the ended one is reported",
    previous: snap("operational", [], [], [windowA, windowB]),
    next: snap("operational", [], [], [windowB]),
    expect: ["maintenance_ended"],
  },
];

for (const c of cases) {
  test(`diff: ${c.name}`, () => {
    const changes = diff(c.previous, c.next);
    assert.deepEqual(
      changes.map((change) => change.kind),
      c.expect,
    );
    for (const change of changes) {
      assert.equal(change.providerId, "github");
      assert.equal(change.at, c.next.fetchedAt);
    }
  });
}

test("a status change carries both sides of the transition", () => {
  const [change] = diff(snap("operational"), snap("degraded"));
  assert.equal(change?.previousStatus, "operational");
  assert.equal(change?.currentStatus, "degraded");
});

test("an incident change carries the incident it is about", () => {
  const changes = diff(snap("operational"), snap("degraded", [inc({ id: "abc" })]));
  const opened = changes.find((change) => change.kind === "incident_opened");
  assert.equal(opened?.incident?.id, "abc");
});

test("a resolved change carries the incident as it was last seen", () => {
  const changes = diff(snap("degraded", [inc({ id: "abc", name: "Gone now" })]), snap("operational"));
  const resolved = changes.find((change) => change.kind === "incident_resolved");
  assert.equal(resolved?.incident?.name, "Gone now");
});

test("diff never mutates its arguments", () => {
  const previous = snap("operational", [inc({ id: "a" })]);
  const next = snap("degraded", [inc({ id: "b" })]);
  const before = JSON.stringify([previous, next]);
  diff(previous, next);
  assert.equal(JSON.stringify([previous, next]), before);
});

test("a component change carries the component and its own statuses", () => {
  const changes = diff(
    snap("operational", [], [comp()]),
    snap("operational", [], [comp({ status: "degraded" })]),
  );
  assert.deepEqual(changes, [
    {
      kind: "component_status_change",
      providerId: "github",
      previousStatus: "operational",
      currentStatus: "degraded",
      component: { id: "c1", name: "Actions" },
      at: "2026-08-19T14:05:00.000Z",
    },
  ]);
});

test("a window that has just started is announced", () => {
  const previous = snap("operational", [], [], []);
  const next = snap("operational", [], [], [running]);

  const changes = diff(previous, next);

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, "maintenance_started");
  assert.equal(changes[0]?.maintenance?.id, "mw1");
});

test("an active window swallows a status change", () => {
  const previous = snap("operational", [], [], [running]);
  const next = snap("major_outage", [], [], [running]);

  assert.deepEqual(diff(previous, next), []);
});

test("an active window swallows a newly opened incident", () => {
  const previous = snap("operational", [], [], [running]);
  const next = snap("operational", [inc({ id: "i9" })], [], [running]);

  assert.deepEqual(diff(previous, next), []);
});

test("an active window swallows a component change", () => {
  const previous = snap("operational", [], [comp({ id: "c1", status: "operational" })], [running]);
  const next = snap("operational", [], [comp({ id: "c1", status: "major_outage" })], [running]);

  assert.deepEqual(diff(previous, next), []);
});

test("a window that ends with the provider recovered reports it as over", () => {
  const previous = snap("operational", [], [], [running]);
  const next = snap("operational", [], [], []);

  const changes = diff(previous, next);

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, "maintenance_ended");
  assert.equal(changes[0]?.currentStatus, "operational");
  assert.equal(changes[0]?.openIncidents, 0);
});

test("a window that ends with the provider still down carries the held-back state", () => {
  const previous = snap("operational", [], [], [running]);
  const next = snap("major_outage", [inc({ id: "i9" })], [], []);

  const changes = diff(previous, next);
  const ended = changes.find((change) => change.kind === "maintenance_ended");

  assert.equal(ended?.currentStatus, "major_outage");
  assert.equal(ended?.openIncidents, 1);
});

test("a first poll landing inside a window announces nothing", () => {
  assert.deepEqual(diff(null, snap("operational", [], [], [running])), []);
});

test("monitoring keeps reporting normally once the window is over", () => {
  const previous = snap("operational", [], [], []);
  const next = snap("degraded", [], [], []);

  assert.equal(diff(previous, next)[0]?.kind, "status_change");
});
