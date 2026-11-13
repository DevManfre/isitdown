import { describe, expect, it } from "vitest";
import { metricConclusion, metricLine } from "./operatorMetric.ts";

const from = Date.parse("2026-11-01T00:00:00Z");
const to = Date.parse("2026-11-02T00:00:00Z");

describe("the operator metric (roadmap 6.11)", () => {
  it("draws from zero to the peak across the window", () => {
    const line = metricLine(
      [
        { at: "2026-11-01T00:00:00Z", value: 0 },
        { at: "2026-11-01T12:00:00Z", value: 4 },
        { at: "2026-11-02T00:00:00Z", value: 2 },
      ],
      from,
      to,
    );
    expect(line.points).toBe("0.0,100.0 500.0,0.0 1000.0,50.0");
    expect(line.max).toBe(4);
  });

  it("an empty series draws nothing and concludes nothing", () => {
    expect(metricLine([], from, to).points).toBe("");
    expect(metricConclusion([], [])).toBeNull();
  });

  it("names the incident running at the peak, or none", () => {
    const points = [
      { at: "2026-11-01T06:00:00Z", value: 1 },
      { at: "2026-11-01T12:00:00Z", value: 9 },
    ];
    const incident = { startMs: Date.parse("2026-11-01T11:00:00Z"), endMs: Date.parse("2026-11-01T13:00:00Z"), providerId: "cloudflare", name: "API errors" };
    expect(metricConclusion(points, [incident])).toEqual({ peak: points[1], during: incident });
    expect(metricConclusion(points, [{ ...incident, endMs: Date.parse("2026-11-01T11:30:00Z") }])?.during).toBeNull();
  });
});
