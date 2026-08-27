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

  it("keeps the antimeridian's two sides apart", () => {
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
