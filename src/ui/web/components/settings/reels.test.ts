import { describe, expect, it } from "vitest";
import { SECTION_REELS } from "./reels.ts";
import { fade, type ReelInk } from "./SettingsReel.tsx";

/**
 * A painter is a pure function of `(width, height, time, ink)`, so it can be
 * checked without a canvas: this records the drawing calls instead of
 * rasterising them. happy-dom has no 2D context at all, and a real one would
 * only let the test assert pixels, which is what `test:visual` is for.
 */
interface Recorder {
  ctx: CanvasRenderingContext2D;
  ops: string[];
  colours: string[];
}

const recorder = (): Recorder => {
  const ops: string[] = [];
  const colours: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      ops.push(`${name}(${args.map((arg) => (typeof arg === "number" ? arg.toFixed(4) : String(arg))).join(",")})`);
    };

  const ctx = {
    beginPath: record("beginPath"),
    fill: record("fill"),
    stroke: record("stroke"),
    arc: record("arc"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    roundRect: record("roundRect"),
    fillRect: record("fillRect"),
    bezierCurveTo: record("bezierCurveTo"),
    createRadialGradient: (...args: number[]) => {
      record("createRadialGradient")(...args);
      return {
        addColorStop: (stop: number, colour: string): void => {
          colours.push(colour);
          ops.push(`addColorStop(${stop},${colour})`);
        },
      };
    },
    set fillStyle(value: string | CanvasGradient) {
      if (typeof value === "string") colours.push(value);
      ops.push(`fillStyle=${typeof value === "string" ? value : "gradient"}`);
    },
    set strokeStyle(value: string) {
      colours.push(value);
      ops.push(`strokeStyle=${value}`);
    },
    set lineWidth(value: number) {
      ops.push(`lineWidth=${value}`);
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, ops, colours };
};

/** Resolved tokens, as `SettingsReel` reads them off the canvas. */
const INK: ReelInk = {
  accent: "oklch(0.7 0.1 280)",
  ok: "oklch(0.8 0.1 150)",
  warn: "oklch(0.8 0.1 80)",
  danger: "oklch(0.6 0.2 25)",
};

const paint = (name: keyof typeof SECTION_REELS, time: number): Recorder => {
  const rec = recorder();
  SECTION_REELS[name](rec.ctx, 320, 120, time, INK);
  return rec;
};

const names = Object.keys(SECTION_REELS) as (keyof typeof SECTION_REELS)[];

describe.each(names)("the %s reel", (name) => {
  it("draws something", () => {
    expect(paint(name, 0).ops.length).toBeGreaterThan(0);
  });

  // The reason the baselines can be byte-stable: `SettingsReel` paints frame 0
  // and stops under reduced motion, which only helps if frame 0 is always the
  // same frame. A painter that reached for Math.random or Date.now would pass
  // every other test here and flap in CI.
  it("paints the same frame for the same instant", () => {
    expect(paint(name, 2.5).ops).toEqual(paint(name, 2.5).ops);
    expect(paint(name, 0).ops).toEqual(paint(name, 0).ops);
  });

  it("paints a different frame as time runs", () => {
    expect(paint(name, 1.7).ops).not.toEqual(paint(name, 0).ops);
  });

  // Colours come from the tokens the component resolved, never from a literal:
  // a hardcoded violet would survive a theme switch and be wrong in the light
  // one. `test/ui/theme.test.ts` guards the CSS; this guards the canvas.
  it("takes every colour from the ink it was handed", () => {
    const inks = Object.values(INK);
    for (const colour of paint(name, 1.1).colours) {
      expect(inks.some((token) => colour.includes(token))).toBe(true);
    }
  });

  it("stays inside the box it is given", () => {
    const wide = paint(name, 0.9);
    const narrow = recorder();
    SECTION_REELS[name](narrow.ctx, 90, 40, 0.9, INK);
    expect(narrow.ops).not.toEqual(wide.ops);
    expect(narrow.ops.length).toBeGreaterThan(0);
  });
});

describe("fade", () => {
  it("mixes a token towards transparent at the alpha asked for", () => {
    expect(fade("var(--primary)", 0.5)).toBe("color-mix(in srgb, var(--primary) 50%, transparent)");
  });

  it("rounds to whole percent, so no painter emits a fractional stop", () => {
    expect(fade("red", 0.333)).toBe("color-mix(in srgb, red 33%, transparent)");
    expect(fade("red", 0)).toBe("color-mix(in srgb, red 0%, transparent)");
    expect(fade("red", 1)).toBe("color-mix(in srgb, red 100%, transparent)");
  });
});
