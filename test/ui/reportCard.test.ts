import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admissionOf,
  buildReportCard,
  quarterRange,
  renderReportCard,
  type ReportCardInput,
} from "../../src/ui/reportCard.ts";
import type { IncidentRow } from "../../src/ui/historyStore.interface.ts";
import type { StoredEpisode } from "../../src/ui/trust.ts";

const incident = (over: Partial<IncidentRow>): IncidentRow => ({
  providerId: "github",
  incidentId: "i1",
  name: "Elevated error rates",
  impact: "major",
  status: "resolved",
  startedAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T11:00:00.000Z",
  resolvedAt: "2026-07-10T11:00:00.000Z",
  ...over,
});

const episode = (delayMinutes: number | null, over: Partial<StoredEpisode> = {}): StoredEpisode => ({
  probeDownAt: "2026-07-10T10:00:00.000Z",
  probeUpAt: "2026-07-10T11:00:00.000Z",
  pageAdmittedAt: delayMinutes === null ? null : "2026-07-10T10:10:00.000Z",
  pageClearedAt: null,
  outcome: delayMinutes === null ? "never" : "admitted",
  excluded: null,
  delayMinutes,
  observedMinutes: 60,
  admittedMinutes: delayMinutes === null ? 0 : 50,
  resolutionMinutes: 1,
  ...over,
} as StoredEpisode);

const input = (over: Partial<ReportCardInput> = {}): ReportCardInput => ({
  quarter: "2026-Q3",
  from: "2026-07-01",
  to: "2026-09-30",
  partial: false,
  generatedAt: "2026-10-01T08:00:00.000Z",
  providers: [{ providerId: "github", name: "GitHub", uptime: 99.93, admission: null }],
  incidents: [],
  ...over,
});

test("a quarter is its three calendar months, and a malformed one is refused", () => {
  assert.deepEqual(quarterRange("2026-Q1"), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(quarterRange("2024-Q1"), { from: "2024-01-01", to: "2024-03-31" });
  assert.deepEqual(quarterRange("2026-Q4"), { from: "2026-10-01", to: "2026-12-31" });
  assert.equal(quarterRange("2026-Q5"), null);
  assert.equal(quarterRange("2026-10"), null);
});

test("every axis gets its own grade, and none is folded into an overall one", () => {
  const card = buildReportCard(
    input({
      incidents: [
        incident({ incidentId: "a", startedAt: "2026-07-10T10:00:00.000Z", resolvedAt: "2026-07-10T10:20:00.000Z" }),
        incident({ incidentId: "b", startedAt: "2026-08-10T10:00:00.000Z", resolvedAt: "2026-08-10T10:40:00.000Z" }),
        incident({ incidentId: "c", startedAt: "2026-09-10T10:00:00.000Z", resolvedAt: "2026-09-10T11:00:00.000Z" }),
      ],
    }),
  );
  const github = card.providers[0]!;
  assert.deepEqual(github.availability, { uptime: 99.93, grade: "B" });
  assert.deepEqual(github.mttr, { minutes: 40, resolved: 3, grade: "B" });
  assert.deepEqual(github.incidents, { count: 3, grade: "C" });
  assert.equal(github.admission, null);
  assert.equal("overall" in github, false);
});

test("an axis the quarter cannot answer has no grade rather than a flattering one", () => {
  const card = buildReportCard(
    input({ providers: [{ providerId: "github", name: "GitHub", uptime: null, admission: null }] }),
  );
  const github = card.providers[0]!;
  assert.deepEqual(github.availability, { uptime: null, grade: null });
  assert.deepEqual(github.mttr, { minutes: null, resolved: 0, grade: null });
  // No incidents is a real answer, though, and the best one.
  assert.deepEqual(github.incidents, { count: 0, grade: "A" });
});

test("only incidents that started inside the quarter count, from this provider", () => {
  const card = buildReportCard(
    input({
      incidents: [
        incident({ incidentId: "before", startedAt: "2026-06-30T23:00:00.000Z", resolvedAt: "2026-07-01T02:00:00.000Z" }),
        incident({ incidentId: "other", providerId: "slack" }),
        incident({ incidentId: "open", resolvedAt: null }),
      ],
    }),
  );
  const github = card.providers[0]!;
  assert.equal(github.incidents.count, 1);
  assert.deepEqual(github.mttr, { minutes: null, resolved: 0, grade: null });
});

test("admission counts a never-admitted outage as the latest possible, not as a missing one", () => {
  // Six outages admitted in two minutes and five never admitted: a median over
  // the admitted ones alone would grade this page A.
  const episodes = [
    ...Array.from({ length: 6 }, () => episode(2)),
    ...Array.from({ length: 5 }, () => episode(null)),
  ];
  const admission = admissionOf(episodes, "2026-07-01", "2026-09-30");
  assert.deepEqual(admission, { counted: 11, admitted: 6, medianMinutes: 2, grade: "A" });

  const mostlyNever = [...Array.from({ length: 4 }, () => episode(2)), ...Array.from({ length: 7 }, () => episode(null))];
  assert.deepEqual(admissionOf(mostlyNever, "2026-07-01", "2026-09-30"), {
    counted: 11,
    admitted: 4,
    medianMinutes: null,
    grade: "E",
  });
});

test("admission stays ungraded below the trust card's ten-episode floor, and outside the quarter nothing counts", () => {
  const few = Array.from({ length: 4 }, () => episode(3));
  assert.deepEqual(admissionOf(few, "2026-07-01", "2026-09-30"), {
    counted: 4,
    admitted: 4,
    medianMinutes: null,
    grade: null,
  });
  const elsewhere = [
    ...Array.from({ length: 12 }, () => episode(3, { probeDownAt: "2026-10-02T00:00:00.000Z" })),
    ...Array.from({ length: 12 }, () => episode(3, { excluded: "maintenance" })),
  ];
  assert.equal(admissionOf(elsewhere, "2026-07-01", "2026-09-30").counted, 0);
});

test("the markdown keeps the axes apart, prints the scale and flags a running quarter", () => {
  const md = renderReportCard(
    buildReportCard(input({ partial: true, to: "2026-08-15" })),
  );
  assert.match(md, /^# Vendor report card — 2026 Q3/m);
  assert.match(md, /\| GitHub \| B · 99\.93% \| — \| — \| A · 0 \|/);
  assert.match(md, /still running/i);
  assert.match(md, /## Scale/);
  assert.match(md, /never combined/i);
});
