import { describe, expect, it } from "vitest";
import { binPoints } from "./mapCells.ts";
import type { MapPoint } from "./types.ts";

const point = (
  lat: number,
  lon: number,
  status: MapPoint["status"] = "operational",
  providerId = "cloudflare",
): MapPoint => ({
  providerId,
  providerName: providerId,
  componentId: `${providerId}-${lat}-${lon}`,
  name: `Somewhere ${lat},${lon}`,
  lat,
  lon,
  status,
  source: "iata",
});

describe("binPoints", () => {
  it("returns nothing for no points", () => {
    expect(binPoints([], 4)).toEqual([]);
  });

  it("merges points inside one cell", () => {
    const cells = binPoints([point(52.0, 4.0), point(52.9, 4.9)], 4);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.count).toBe(2);
  });

  it("separates points in different cells", () => {
    expect(binPoints([point(52.0, 4.0), point(20.0, 100.0)], 4)).toHaveLength(2);
  });

  it("takes the worst status in the cell", () => {
    const cells = binPoints([point(52.0, 4.0, "operational"), point(52.1, 4.1, "major_outage")], 4);
    expect(cells[0]?.worst).toBe("major_outage");
  });

  it("ranks unknown below a real fault", () => {
    // Same rule the Overview's beacon uses: "we did not measure" must not read
    // louder than "it is down".
    const cells = binPoints([point(52.0, 4.0, "unknown"), point(52.1, 4.1, "degraded")], 4);
    expect(cells[0]?.worst).toBe("degraded");
  });

  it("names partial_outage rather than collapsing it into degraded", () => {
    // The colour collapse (both share the warn tier) is correct and
    // deliberate; the status NAME is not allowed to collapse the same way,
    // because the tooltip and aria-label both render it verbatim.
    const cells = binPoints([point(52.0, 4.0, "partial_outage")], 4);
    expect(cells[0]?.worst).toBe("partial_outage");
  });

  it("bins by floor, not by rounding", () => {
    // 1.9 and 2.1 both fall in cell 0 under floor (0.475 and 0.525 both floor
    // to 0) but split into cells 0 and 1 under rounding. This is the pair that
    // pins the operator; the antimeridian pair below yields two cells either
    // way and pins only that ±179 stay apart.
    expect(binPoints([point(0, 1.9), point(0, 2.1)], 4)).toHaveLength(1);
  });

  it("keeps the antimeridian's two sides from merging", () => {
    // Not evidence for floor over round — both partition ±179 into separate
    // cells at 4°. What this pins is that a longitude wrap near ±180 does not
    // fold two opposite-side points into one bucket.
    const cells = binPoints([point(0, 179), point(0, -179)], 4);
    expect(cells).toHaveLength(2);
  });

  it("keeps a cell centroid inside valid latitude", () => {
    for (const cell of binPoints([point(90, 0), point(-90, 0)], 4)) {
      expect(cell.lat).toBeGreaterThanOrEqual(-90);
      expect(cell.lat).toBeLessThanOrEqual(90);
    }
  });

  it("keeps both providers' points in a shared cell", () => {
    const cells = binPoints([point(52.0, 4.0, "operational", "cloudflare"), point(52.1, 4.1, "degraded", "fastly")], 4);
    expect(cells).toHaveLength(1);
    expect(new Set(cells[0]?.points.map((p) => p.providerId))).toEqual(new Set(["cloudflare", "fastly"]));
  });

  it("returns cells in a stable order regardless of input order", () => {
    const a = binPoints([point(52, 4), point(-20, 130)], 4).map((c) => `${c.lat},${c.lon}`);
    const b = binPoints([point(-20, 130), point(52, 4)], 4).map((c) => `${c.lat},${c.lon}`);
    expect(a).toEqual(b);
  });
});
