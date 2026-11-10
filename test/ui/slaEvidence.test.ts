import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncidentRow, SampleRow } from "../../src/ui/historyStore.interface.ts";
import type { MonthlyProviderReport } from "../../src/ui/history.ts";
import {
  buildSlaEvidence,
  downtimeWindows,
  renderSlaEvidence,
  type SlaEvidenceInput,
} from "../../src/ui/slaEvidence.ts";

const sample = (observedAt: string, overallStatus: SampleRow["overallStatus"]): SampleRow => ({
  observedAt,
  overallStatus,
  ok: overallStatus === "operational",
});

const incident = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  providerId: "github",
  incidentId: "inc-42",
  name: "Elevated API errors",
  impact: "major",
  status: "resolved",
  startedAt: "2026-08-04T10:03:00.000Z",
  updatedAt: "2026-08-04T10:30:00.000Z",
  resolvedAt: "2026-08-04T10:30:00.000Z",
  ...over,
});

const report = (over: Partial<MonthlyProviderReport> = {}): MonthlyProviderReport => ({
  providerId: "github",
  uptime: 99.5,
  measuredDays: 31,
  sampleCount: 6,
  downtimeMinutes: 15,
  downtimeCost: null,
  incidentCount: 1,
  worstDay: { day: "2026-08-04", uptime: 50, status: "major_outage" },
  days: [],
  ...over,
});

const input = (over: Partial<SlaEvidenceInput> = {}): SlaEvidenceInput => ({
  providerId: "github",
  providerName: "GitHub",
  statusPage: "https://www.githubstatus.com",
  target: 99.9,
  month: "2026-08",
  from: "2026-08-01",
  to: "2026-08-31",
  partial: false,
  monthMinutes: 31 * 24 * 60,
  intervalMinutes: 5,
  report: report(),
  samples: [],
  incidents: [],
  generatedAt: "2026-09-01T08:00:00.000Z",
  ...over,
});

test("a run of bad polls is one window, closed by the next good poll and counted one interval per poll", () => {
  const windows = downtimeWindows(
    [
      sample("2026-08-04T10:00:00.000Z", "operational"),
      sample("2026-08-04T10:05:00.000Z", "degraded"),
      sample("2026-08-04T10:10:00.000Z", "major_outage"),
      sample("2026-08-04T10:15:00.000Z", "degraded"),
      sample("2026-08-04T10:20:00.000Z", "operational"),
    ],
    5,
    [incident()],
  );

  assert.deepEqual(windows, [
    {
      startedAt: "2026-08-04T10:05:00.000Z",
      endedAt: "2026-08-04T10:20:00.000Z",
      minutes: 15,
      worstStatus: "major_outage",
      incidentIds: ["inc-42"],
    },
  ]);
});

test("a window still open at the last poll has no end rather than an invented one", () => {
  const windows = downtimeWindows(
    [sample("2026-08-31T23:50:00.000Z", "operational"), sample("2026-08-31T23:55:00.000Z", "partial_outage")],
    5,
    [],
  );

  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.endedAt, null);
  assert.deepEqual(windows[0]?.incidentIds, []);
});

test("an incident that does not touch a window is not credited to it", () => {
  const windows = downtimeWindows(
    [sample("2026-08-10T10:00:00.000Z", "degraded"), sample("2026-08-10T10:05:00.000Z", "operational")],
    5,
    [incident()],
  );

  assert.deepEqual(windows[0]?.incidentIds, []);
});

test("below the target, the document says a credit may be owed and lists the windows and the provider's incidents", () => {
  const text = renderSlaEvidence(
    buildSlaEvidence(
      input({
        samples: [
          sample("2026-08-04T10:05:00.000Z", "major_outage"),
          sample("2026-08-04T10:10:00.000Z", "operational"),
        ],
        incidents: [incident({ name: "Errors | retries" })],
        report: report({ sampleCount: 2 }),
      }),
    ),
  );

  assert.match(text, /^# SLA evidence — GitHub, August 2026/);
  assert.match(text, /below the committed 99\.90%/);
  assert.match(text, /service credit/);
  assert.match(text, /\| 2026-08-04T10:05:00\.000Z \| 2026-08-04T10:10:00\.000Z \| 5 \| major outage \| inc-42 \|/);
  // A pipe in the provider's title must not split the row.
  assert.match(text, /Errors \\\| retries/);
  // 99.9% of a 31-day month allows 44.64 minutes.
  assert.match(text, /\(45 minutes\)/);
});

test("meeting the target is said plainly, with no hint of a credit", () => {
  const text = renderSlaEvidence(buildSlaEvidence(input({ report: report({ uptime: 99.95 }) })));

  assert.match(text, /meets the committed 99\.90%/);
  assert.doesNotMatch(text, /service credit/);
});

test("polls retention already rolled up are reported missing, not read as uptime", () => {
  const evidence = buildSlaEvidence(
    input({ report: report({ sampleCount: 100 }), samples: [sample("2026-08-30T00:00:00.000Z", "operational")] }),
  );

  assert.equal(evidence.rawSampleCount, 1);
  assert.match(renderSlaEvidence(evidence), /99 of the 100 polls in this period are no longer held one by one/);
});

test("a month nobody measured makes no claim either way", () => {
  const evidence = buildSlaEvidence(input({ report: report({ uptime: null, sampleCount: 0 }) }));

  assert.equal(evidence.belowTarget, false);
  assert.match(renderSlaEvidence(evidence), /Nothing was measured/);
});

test("a running month warns that the figure can still move", () => {
  const text = renderSlaEvidence(buildSlaEvidence(input({ partial: true })));

  assert.match(text, /month still running/);
  assert.match(text, /The month is not over/);
});
