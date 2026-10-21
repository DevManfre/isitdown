import { test } from "node:test";
import assert from "node:assert/strict";
import { cellsOf, createChartService, renderUptimeBar } from "../../src/ui/uptimeChart.ts";
import type { SampleRow } from "../../src/ui/historyStore.interface.ts";

const now = new Date("2026-10-21T12:00:00.000Z");
const at = (minutesAgo: number): string => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
const sample = (minutesAgo: number, overallStatus: SampleRow["overallStatus"]): SampleRow => ({
  observedAt: at(minutesAgo),
  overallStatus,
  ok: true,
});

test("each half hour takes the worst reading inside it, and an unread one stays empty", () => {
  const cells = cellsOf([sample(5, "operational"), sample(10, "major_outage"), sample(200, "degraded")], now);

  assert.equal(cells.length, 48);
  assert.equal(cells[47], "major_outage", "a five-minute outage is not averaged away");
  assert.equal(cells[41], "degraded", "200 minutes back is 1240 minutes into the day, so cell 41");
  assert.equal(cells[0], "none");
});

test("readings outside the 24 hours are ignored", () => {
  const cells = cellsOf([sample(24 * 60 + 60, "major_outage"), sample(-60, "major_outage")], now);
  assert.ok(cells.every((cell) => cell === "none"));
});

test("an unknown reading never hides a real one in the same half hour", () => {
  assert.equal(cellsOf([sample(5, "unknown"), sample(6, "degraded")], now)[47], "degraded");
});

test("the bar is an SVG that says its conclusion in text, with every cell titled", () => {
  const svg = renderUptimeBar([sample(5, "major_outage"), sample(400, "operational")], now, 'Git<Hub> "x"');

  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Git&lt;Hub&gt; &quot;x&quot;: 1 of 2 measured half hours had a problem/);
  assert.equal(svg.match(/<rect /g)?.length, 48);
  assert.equal(svg.match(/<rect [^>]*><title>/g)?.length, 48, "colour is never the only carrier");
  assert.ok(!svg.includes("Git<Hub>"), "a provider's name cannot inject markup");
});

test("a provider that was never measured gets no chart rather than an empty one", async () => {
  const charts = createChartService({ recentSamples: async () => [], now: () => now });
  assert.equal(await charts.uptimeBar("github", "GitHub", 3), null);
});

test("a day of readings is asked for at the cadence they were polled at, with room for faster polling", async () => {
  const asked: number[] = [];
  const charts = createChartService({
    recentSamples: async (_id, limit) => {
      asked.push(limit);
      return [sample(5, "operational")];
    },
    now: () => now,
  });
  assert.ok((await charts.uptimeBar("github", "GitHub", 3)) !== null);
  assert.equal(asked[0], (24 * 60 / 3) * 3);
});
