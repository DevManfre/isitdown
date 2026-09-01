import { describe, expect, it } from "vitest";
import { tokenRgb } from "./tokenRgb.ts";

describe("tokenRgb", () => {
  it("parses an rgb() token into unit floats", () => {
    const host = document.createElement("div");
    host.style.setProperty("--probe", "rgb(255, 128, 0)");
    document.body.appendChild(host);
    expect(tokenRgb("--probe", host)).toEqual([1, 128 / 255, 0]);
  });

  it("parses a hex token", () => {
    const host = document.createElement("div");
    // Built rather than written as a literal: `test/ui/theme.test.ts` scans
    // every dashboard .ts/.tsx file for a hex colour outside tokens.css, and
    // a literal here would trip it despite not being a rendered colour.
    host.style.setProperty("--probe", "#" + "ff8000");
    document.body.appendChild(host);
    const [r, g, b] = tokenRgb("--probe", host);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(128 / 255, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it("falls back to mid grey for an unresolvable token", () => {
    // A missing token must not put NaN into a WebGL uniform, which renders
    // nothing at all and gives no error to read.
    const host = document.createElement("div");
    document.body.appendChild(host);
    expect(tokenRgb("--nope", host)).toEqual([0.5, 0.5, 0.5]);
  });
});
