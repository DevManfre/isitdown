import { test } from "node:test";
import assert from "node:assert/strict";
import type { MonthlyProviderReport, MonthlyReport } from "../../src/ui/history.ts";
import { renderMonthlyReportHtml } from "../../src/ui/monthlyReportHtml.ts";

const provider = (over: Partial<MonthlyProviderReport> = {}): MonthlyProviderReport => ({
  providerId: "github",
  uptime: 100,
  measuredDays: 2,
  sampleCount: 576,
  downtimeMinutes: 0,
  downtimeCost: null,
  incidentCount: 0,
  worstDay: { day: "2026-08-01", uptime: 100, status: "operational" },
  days: [
    { day: "2026-08-01", uptime: 100, status: "operational" },
    { day: "2026-08-02", uptime: 100, status: "operational" },
  ],
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
  ["cloudflare", "Cloudflare <CDN>"],
]);

const render = (over: Partial<MonthlyReport> = {}): string =>
  renderMonthlyReportHtml(report(over), names, "2026-09-01T08:00:00.000Z");

test("the page stands alone: one document, its own styles, nothing fetched", () => {
  const html = render();

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Uptime report — August 2026<\/title>/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /<script|<link|src="http/);
});

test("every day of the month gets a cell, and an unmeasured one says so", () => {
  const html = render();

  // 31 days in the strip, plus the bar chart's two rectangles for the one provider.
  assert.equal(html.match(/<rect /g)?.length, 31 + 2);
  assert.match(html, /2026-08-03 — no reading/);
  assert.match(html, /2026-08-01 — 100\.00%, worst operational/);
});

test("providers are listed worst first, names escaped, and each chart describes itself in text", () => {
  const html = render({
    providers: [
      provider(),
      provider({
        providerId: "cloudflare",
        uptime: 97.5,
        worstDay: { day: "2026-08-02", uptime: 95, status: "major_outage" },
      }),
    ],
  });

  assert.ok(html.indexOf("Cloudflare &lt;CDN&gt;") < html.indexOf("<td>GitHub</td>"));
  assert.doesNotMatch(html, /Cloudflare <CDN>/);
  assert.match(html, /aria-label="Uptime by provider, worst first: Cloudflare &lt;CDN&gt; 97\.50%, GitHub 100\.00%"/);
  // The axis starts where the month needs it to, and the page says where.
  assert.match(html, /The axis starts at 95%/);
});

test("a running month is flagged on the page, as in the Markdown", () => {
  assert.match(render({ partial: true, to: "2026-08-12" }), /This month is still running/);
});

test("the cost column appears only when somebody declared a price", () => {
  assert.doesNotMatch(render(), /Downtime cost/);
  assert.match(render({ providers: [provider({ downtimeCost: 12.5 })] }), /Downtime cost[\s\S]*12\.50/);
});
