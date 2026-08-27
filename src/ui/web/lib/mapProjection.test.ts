import { describe, expect, it } from "vitest";
import { projectEquirect } from "./mapProjection.ts";

describe("projectEquirect", () => {
  it("puts 0,0 at the centre", () => {
    expect(projectEquirect(0, 0, 100, 50)).toEqual({ x: 50, y: 25 });
  });

  it("puts the antimeridian at both edges", () => {
    expect(projectEquirect(0, -180, 100, 50).x).toBe(0);
    expect(projectEquirect(0, 180, 100, 50).x).toBe(100);
  });

  it("puts the north pole at the top", () => {
    expect(projectEquirect(90, 0, 100, 50).y).toBe(0);
  });

  it("puts the south pole at the bottom", () => {
    expect(projectEquirect(-90, 0, 100, 50).y).toBe(50);
  });

  it("places Amsterdam in the northern hemisphere, east of centre", () => {
    const { x, y } = projectEquirect(52.31, 4.76, 1000, 500);
    expect(x).toBeGreaterThan(500);
    expect(y).toBeLessThan(250);
  });
});
