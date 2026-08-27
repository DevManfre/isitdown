import { describe, expect, it } from "vitest";
import { projectGlobe } from "./globeProjection.ts";

const R = 100;

describe("projectGlobe", () => {
  it("puts the point facing the viewer at the centre", () => {
    const { x, y, facing } = projectGlobe(0, 0, 0, 0, R);
    expect(facing).toBe(true);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("hides the point on the far side", () => {
    expect(projectGlobe(0, 180, 0, 0, R).facing).toBe(false);
  });

  it("puts the north pole above the centre", () => {
    // theta = 0 (no tilt) is the one case where this assertion is exact
    // rather than approximate-by-construction: with no tilt, the pole
    // projects straight up, y = -radius. This does NOT also assert
    // `facing` — at theta = 0 the pole sits exactly on the visibility
    // terminator (z1 is mathematically 0), and floating point rounds
    // that to a tiny positive epsilon (`Math.cos(Math.PI / 2)` is
    // `6.123233995736766e-17`, not 0) rather than to 0 itself. Asserting
    // `facing` here would pin that rounding artifact, not a real
    // invariant — a harmless reordering of the trigonometry could flip
    // its sign. See the next test for `facing` away from this edge.
    const { y } = projectGlobe(90, 0, 0, 0, R);
    expect(y).toBeCloseTo(-R, 5);
  });

  it("keeps the north pole facing once the globe is tilted away from the flat case", () => {
    // theta = 0.25 is production's own tilt (`THETA` in StatusGlobe.tsx),
    // well clear of the theta = 0 terminator case above.
    expect(projectGlobe(90, 0, 0, 0.25, R).facing).toBe(true);
  });

  it("keeps every projected point inside the disc", () => {
    for (const lat of [-80, -40, 0, 40, 80]) {
      for (const lon of [-170, -90, 0, 90, 170]) {
        const { x, y } = projectGlobe(lat, lon, 0.7, 0.3, R);
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(R + 1e-6);
      }
    }
  });

  it("brings a hidden point into view when the globe rotates to it", () => {
    expect(projectGlobe(0, 180, 0, 0, R).facing).toBe(false);
    expect(projectGlobe(0, 180, Math.PI, 0, R).facing).toBe(true);
  });
});
