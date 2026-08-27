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
    const { y, facing } = projectGlobe(90, 0, 0, 0, R);
    expect(facing).toBe(true);
    expect(y).toBeCloseTo(-R, 5);
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
