import { describe, expect, it } from "vitest";
import { overlaps, timelineLanes, type TimelineIncident } from "./incidentTimeline.ts";

const DAY = 24 * 60 * 60 * 1000;
const from = Date.UTC(2026, 9, 1);
const to = from + 10 * DAY;
const at = (day: number, hour = 0): string => new Date(from + day * DAY + hour * 3_600_000).toISOString();

const incident = (over: Partial<TimelineIncident>): TimelineIncident => ({
  providerId: "github",
  incidentId: "a",
  name: "Outage",
  impact: "major",
  startedAt: at(1),
  resolvedAt: at(2),
  ...over,
});

describe("timelineLanes", () => {
  it("places a bar as a share of the window, one lane per provider in the order given", () => {
    const lanes = timelineLanes(
      [incident({}), incident({ providerId: "cloudflare", incidentId: "b", startedAt: at(5), resolvedAt: at(6) })],
      ["github", "cloudflare"],
      from,
      to,
    );

    expect(lanes.map((lane) => lane.providerId)).toEqual(["github", "cloudflare"]);
    expect(lanes[0]?.bars[0]).toMatchObject({ left: 10, width: 10 });
    expect(lanes[1]?.bars[0]).toMatchObject({ left: 50, width: 10 });
  });

  it("clips an incident that began before the window or is still open to the window's edges", () => {
    const [lane] = timelineLanes(
      [incident({ startedAt: at(-3), resolvedAt: null })],
      ["github"],
      from,
      to,
    );

    expect(lane?.bars[0]).toMatchObject({ left: 0, width: 100, open: true });
  });

  it("keeps a lane for a provider with no incident, so the rows do not shift", () => {
    const lanes = timelineLanes([], ["github"], from, to);
    expect(lanes).toEqual([{ providerId: "github", bars: [] }]);
  });

  it("drops an incident that ended before the window", () => {
    const [lane] = timelineLanes([incident({ startedAt: at(-5), resolvedAt: at(-4) })], ["github"], from, to);
    expect(lane?.bars).toEqual([]);
  });
});

describe("overlaps", () => {
  it("finds where two providers were both in an incident, and which ones", () => {
    const found = overlaps(
      [
        incident({ providerId: "github", startedAt: at(1), resolvedAt: at(4) }),
        incident({ providerId: "cloudflare", incidentId: "b", startedAt: at(3), resolvedAt: at(6) }),
      ],
      from,
      to,
    );

    expect(found).toEqual([
      { startMs: from + 3 * DAY, endMs: from + 4 * DAY, providerIds: ["cloudflare", "github"] },
    ]);
  });

  it("is not an overlap when one provider's own incidents overlap each other", () => {
    expect(
      overlaps(
        [
          incident({ incidentId: "a", startedAt: at(1), resolvedAt: at(4) }),
          incident({ incidentId: "b", startedAt: at(2), resolvedAt: at(5) }),
        ],
        from,
        to,
      ),
    ).toEqual([]);
  });

  it("is empty when nothing overlaps", () => {
    expect(
      overlaps(
        [
          incident({ providerId: "github", startedAt: at(1), resolvedAt: at(2) }),
          incident({ providerId: "cloudflare", incidentId: "b", startedAt: at(3), resolvedAt: at(4) }),
        ],
        from,
        to,
      ),
    ).toEqual([]);
  });
});
