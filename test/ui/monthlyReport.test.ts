import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, monthTitle, renderMonthlyReport } from "../../src/ui/monthlyReport.ts";
import type { MonthlyProviderReport, MonthlyReport } from "../../src/ui/history.ts";

const provider = (over: Partial<MonthlyProviderReport> = {}): MonthlyProviderReport => ({
  providerId: "github",
  uptime: 100,
  measuredDays: 31,
  sampleCount: 14_880,
  downtimeMinutes: 0,
  incidentCount: 0,
  worstDay: { day: "2026-08-04", uptime: 100, status: "operational" },
  ...over,
});

const report = (over: Partial<MonthlyReport> = {}): MonthlyReport => ({
  month: "2026-08",
  from: "2026-08-01",
  to: "2026-08-31",
  partial: false,
  fleetUptime: 100,
  providers: [provider()],
  incidents: [],
  ...over,
});

const names = new Map([
  ["github", "GitHub"],
  ["cloudflare", "Cloudflare"],
]);

test("the month is titled the way somebody says it out loud", () => {
  assert.equal(monthTitle("2026-08"), "August 2026");
  // Not a month, and the report is not the place to discover that.
  assert.equal(monthTitle("whenever"), "whenever");
});

test("downtime is read as a duration rather than as a number to convert", () => {
  assert.equal(duration(0), "none");
  assert.equal(duration(42), "42 m");
  assert.equal(duration(120), "2 h");
  assert.equal(duration(192), "3 h 12 m");
});

test("the worst month is the first row, so the report reads from the top", () => {
  const rendered = renderMonthlyReport(
    report({
      providers: [
        provider({ providerId: "github", uptime: 99.9 }),
        provider({ providerId: "cloudflare", uptime: 91.2 }),
      ],
    }),
    names,
  );

  assert.ok(rendered.indexOf("| Cloudflare |") < rendered.indexOf("| GitHub |"), rendered);
});

test("a provider nothing measured sorts last and reads as a dash, never as nought", () => {
  const rendered = renderMonthlyReport(
    report({
      fleetUptime: 91.2,
      providers: [
        provider({ providerId: "github", uptime: null, measuredDays: 0, worstDay: null }),
        provider({ providerId: "cloudflare", uptime: 91.2 }),
      ],
    }),
    names,
  );

  assert.ok(rendered.indexOf("| Cloudflare |") < rendered.indexOf("| GitHub |"), rendered);
  assert.match(rendered, /\| GitHub \| — \| none \| 0 \| — \| 0 \|/);
});

test("a provider the dashboard has no name for is still named, by its id", () => {
  const rendered = renderMonthlyReport(report({ providers: [provider({ providerId: "unlisted" })] }), new Map());

  assert.match(rendered, /\| unlisted \|/);
});

test("a pipe in a provider's incident name does not break the row it is in", () => {
  const rendered = renderMonthlyReport(
    report({
      incidents: [
        {
          providerId: "github",
          incidentId: "i1",
          name: "API | web degraded",
          impact: "major",
          status: "investigating",
          startedAt: "2026-08-04T10:00:00.000Z",
          updatedAt: "2026-08-04T11:00:00.000Z",
          resolvedAt: null,
        },
      ],
    }),
    names,
  );

  assert.match(rendered, /API \\\| web degraded/);
  // An incident with no resolution says so, rather than leaving the cell blank.
  assert.match(rendered, /\| still open \|/);
});

test("a month with nothing to report says so rather than printing an empty table", () => {
  const rendered = renderMonthlyReport(report(), names);

  assert.match(rendered, /No incident was open at any point in the month\./);
  assert.ok(!rendered.includes("still running"), rendered);
});

test("a partial month says it is partial, and how far it got", () => {
  const rendered = renderMonthlyReport(report({ partial: true, to: "2026-08-19" }), names);

  assert.match(rendered, /\*\*This month is still running\*\*.*2026-08-19/);
});
