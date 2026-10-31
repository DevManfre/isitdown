import { describe, expect, it } from "vitest";
import { alignSeries, uptimeForRange } from "./history.ts";
import type { ProviderHistory } from "./types.ts";

const provider = (over: Partial<ProviderHistory> = {}): ProviderHistory => ({
  providerId: "github",
  buckets: [],
  uptime7: 100,
  uptime30: 99,
  uptime90: 98,
  sampleCount: 10,
  incidentCount: 0,
  downtimeMinutes: 0,
  dailySeries: [],
  previousUptime: null,
  dailyCoverage: [],
  coverage: null,
  detectionDelay: null,
  ...over,
});

describe("uptimeForRange", () => {
  it("answers with the figure for the window the view is showing", () => {
    const history = provider();
    expect(uptimeForRange(history, 7)).toBe(100);
    expect(uptimeForRange(history, 30)).toBe(99);
    expect(uptimeForRange(history, 90)).toBe(98);
  });
});

describe("alignSeries", () => {
  it("puts two providers' days on one row so a chart can overlay them", () => {
    const rows = alignSeries([
      provider({
        dailySeries: [
          { day: "2026-08-18", uptime: 100 },
          { day: "2026-08-19", uptime: 99 },
        ],
      }),
      provider({
        providerId: "cloudflare",
        dailySeries: [
          { day: "2026-08-18", uptime: 80 },
          { day: "2026-08-19", uptime: 70 },
        ],
      }),
    ]);

    expect(rows).toEqual([
      { day: "2026-08-18", values: [100, 80] },
      { day: "2026-08-19", values: [99, 70] },
    ]);
  });

  it("keeps a day only one of them measured, with the other left unmeasured", () => {
    const rows = alignSeries([
      provider({ dailySeries: [{ day: "2026-08-18", uptime: 100 }] }),
      provider({ providerId: "cloudflare", dailySeries: [{ day: "2026-08-19", uptime: 70 }] }),
    ]);

    // Never 0 for the missing side: a provider that was not watched that day
    // did not have a full outage, and a line drawn to zero would say it did.
    expect(rows).toEqual([
      { day: "2026-08-18", values: [100, null] },
      { day: "2026-08-19", values: [null, 70] },
    ]);
  });

  it("returns the days in order whatever order the series arrive in", () => {
    const rows = alignSeries([
      provider({
        dailySeries: [
          { day: "2026-08-20", uptime: 100 },
          { day: "2026-08-18", uptime: 90 },
        ],
      }),
      provider({ providerId: "cloudflare", dailySeries: [{ day: "2026-08-19", uptime: 70 }] }),
    ]);

    expect(rows.map((row) => row.day)).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
  });

  it("carries as many series as it is given, one value each in the order given", () => {
    const rows = alignSeries(
      ["a", "b", "c", "d", "e"].map((providerId, index) =>
        provider({ providerId, dailySeries: [{ day: "2026-08-18", uptime: 90 + index }] }),
      ),
    );

    expect(rows).toEqual([{ day: "2026-08-18", values: [90, 91, 92, 93, 94] }]);
  });
});
