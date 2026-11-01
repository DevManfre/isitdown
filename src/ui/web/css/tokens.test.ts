/// <reference types="node" />
// @vitest-environment node
//
// This suite only reads tokens.css from disk; it has no DOM dependency. The
// repo's global Vitest environment is happy-dom (for component tests), under
// which Vite rewrites `new URL("./tokens.css", import.meta.url)` into a
// dev-server network URL instead of a real file:// URL, so readFileSync
// throws "The URL must be of scheme file". Forcing node for this file keeps
// import.meta.url a literal file:// URL.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK_INK, LIGHT_INK, rgbToHex } from "../lib/accent.ts";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Assertions run against the code, not the prose that documents it.
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Byte offset of one CSS block's real rule, by its selector (which must
 * include the trailing " {").
 *
 * A plain `css.indexOf(selector)` also matches this file's own header
 * comment, which quotes ':root[data-theme="dark"]' in prose describing the
 * palette's structure, on a line that happens to start with exactly that
 * text. `indexOf` lands on the prose, then the caller's own `indexOf("{", …)`
 * walks forward to the *next* "{" in the file — which belongs to a
 * different block entirely (in practice, the light block), so a selector
 * without its brace silently resolves to the wrong rule. Requiring the
 * selector's own opening brace, anchored to the start of a line, rules the
 * prose out: that comment line is never followed immediately by "{".
 */
function blockStart(selector: string): number {
  const pattern = new RegExp(`^\\s*${escapeRegExp(selector)}`, "m");
  const match = pattern.exec(css);
  expect(match, `tokens.css has no ${selector} block`).not.toBeNull();
  return match!.index;
}

/** Custom properties declared inside one CSS block, by its selector. */
function declaredIn(selector: string): string[] {
  const open = css.indexOf("{", blockStart(selector));
  const close = css.indexOf("}", open);
  return [...strip(css.slice(open, close)).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string).sort();
}

const SEMANTIC = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--popover", "--popover-foreground", "--primary", "--primary-foreground",
  "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
  "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
  "--border", "--input", "--ring", "--radius",
];

const BLOCKS = [":root {", ':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {'];

describe("the shadcn theme contract", () => {
  it("declares every semantic token in every theme block", () => {
    for (const block of BLOCKS) {
      const declared = declaredIn(block);
      for (const token of SEMANTIC) {
        expect(declared, `${block} is missing ${token}`).toContain(token);
      }
    }
  });

  it("declares the same token set in every theme block", () => {
    const [light, dark, system] = BLOCKS.map(declaredIn);
    expect(dark).toEqual(light);
    expect(system).toEqual(dark);
  });

  it("resolves every semantic token to a palette var, never a literal", () => {
    for (const block of BLOCKS) {
      const open = css.indexOf("{", blockStart(block));
      const body = css.slice(open, css.indexOf("}", open));
      for (const token of SEMANTIC) {
        if (token === "--radius") continue;
        const match = body.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
        expect(match, `${block} does not declare ${token}`).not.toBeNull();
        expect(match?.[1], `${token} in ${block} must reference a palette var`).toMatch(/var\(--/);
      }
    }
  });

  it("declares no --bar-* token, which Recharts replaced", () => {
    expect(strip(css)).not.toMatch(/--bar-/);
  });

  it("binds the dark variant to the data-theme attribute, not a class", () => {
    expect(strip(css)).toMatch(/@custom-variant\s+dark\s*\(&:where\(\[data-theme="dark"\]/);
    expect(strip(css)).not.toMatch(/@custom-variant\s+dark\s*\(&:is\(\.dark/);
  });
});

/**
 * The contrast audit (roadmap 5.13), as arithmetic rather than as a promise.
 *
 * Every status token here is used as *text*: `statusColor()` paints the status
 * word beside a provider, in a table cell and in a ring's caption. The dark
 * palette had two defects a screenshot could not show — a partial outage and a
 * major one shared one colour, and `--status-unknown` was the near-background
 * grey the unsampled bars need, which as text is not text. Both are fixed in
 * tokens.css; this suite is what stops the next palette pass from undoing it.
 */
const CHANNEL = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return 0.2126 * CHANNEL(r as number) + 0.7152 * CHANNEL(g as number) + 0.0722 * CHANNEL(b as number);
}

/** WCAG 2.1 relative contrast, the (L+0.05) ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** One literal hex value declared in a theme block. */
function hexIn(block: string, token: string): string {
  const open = css.indexOf("{", blockStart(block));
  const body = strip(css.slice(open, css.indexOf("}", open)));
  const match = body.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{6});`, "i"));
  expect(match, `${block} does not declare ${token} as a hex literal`).not.toBeNull();
  return (match?.[1] as string).toLowerCase();
}

/** The status words an operator reads, per theme block that declares a palette. */
const STATUS_TEXT_TOKENS = [
  "--status-operational",
  "--status-degraded",
  "--status-partial-outage",
  "--status-major-outage",
  "--status-unknown",
  "--status-accent",
];

const PALETTE_BLOCKS = [":root {", ':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {'];

describe("the status palette's contrast", () => {
  it("clears WCAG AA on both grounds, in every theme", () => {
    for (const block of PALETTE_BLOCKS) {
      const bg = hexIn(block, "--color-bg");
      const surface = hexIn(block, "--color-surface");
      for (const token of STATUS_TEXT_TOKENS) {
        const colour = hexIn(block, token);
        for (const [name, ground] of [
          ["--color-bg", bg],
          ["--color-surface", surface],
        ] as [string, string][]) {
          const ratio = contrast(colour, ground);
          expect(ratio, `${block} ${token} on ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  // Roadmap 4.20. The Overview draws a status word as a large figure on its own
  // wash — 10-12% of the same hue over the card — which is a darker ground than
  // the card itself, and the test above never measured it. axe did.
  it("clears WCAG AA on the wash each word is drawn over, not just on the bare ground", () => {
    const tintOf: Record<string, string> = {
      "--status-operational": "--status-operational-tint",
      "--status-degraded": "--status-degraded-tint",
      "--status-partial-outage": "--status-outage-tint",
      "--status-major-outage": "--status-outage-tint",
      "--status-accent": "--status-accent-tint",
    };
    const blend = (hex: string, [r, g, b, a]: [number, number, number, number]): string => {
      const ground = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
      const mixed = [r, g, b].map((channel, i) => Math.round(channel * a + (ground[i] as number) * (1 - a)));
      return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const block of PALETTE_BLOCKS) {
      const open = css.indexOf("{", blockStart(block));
      const body = strip(css.slice(open, css.indexOf("}", open)));
      for (const [token, tintToken] of Object.entries(tintOf)) {
        const match = body.match(new RegExp(`${tintToken}\\s*:\\s*rgba\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)\\)`));
        expect(match, `${block} does not declare ${tintToken} as rgba()`).not.toBeNull();
        const rgba = match!.slice(1, 5).map(Number) as [number, number, number, number];
        for (const ground of ["--color-bg", "--color-surface"]) {
          const wash = blend(hexIn(block, ground), rgba);
          const ratio = contrast(hexIn(block, token), wash);
          expect(ratio, `${block} ${token} on its tint over ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  // Roadmap 4.20. Secondary copy is drawn on the chip fill as well as on the
  // page — every Badge, kbd and count — and in dark that pair was 3.46:1.
  it("keeps secondary copy at 4.5:1 on the chip fill as well as on the page", () => {
    for (const block of PALETTE_BLOCKS) {
      const text = hexIn(block, "--color-neutral-500");
      for (const [name, ground] of [
        ["--color-bg", hexIn(block, "--color-bg")],
        ["--color-surface", hexIn(block, "--color-surface")],
        ["--color-neutral-800 (the chip fill)", hexIn(block, "--color-neutral-800")],
      ] as [string, string][]) {
        const ratio = contrast(text, ground);
        expect(ratio, `${block} secondary copy on ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives every severity its own colour, so two readings are never one", () => {
    for (const block of PALETTE_BLOCKS) {
      const values = STATUS_TEXT_TOKENS.map((token) => hexIn(block, token));
      expect(new Set(values).size, `${block} paints two severities the same`).toBe(values.length);
    }
  });

  it("keeps the unsampled-bar grey out of the text token", () => {
    // The bars want a grey that disappears into the page; the label cannot
    // have it. They are two tokens precisely so one can be unreadable.
    for (const block of PALETTE_BLOCKS) {
      const bg = hexIn(block, "--color-bg");
      const fill = hexIn(block, "--status-unknown-fill");
      const text = hexIn(block, "--status-unknown");
      if (contrast(fill, bg) < 4.5) {
        expect(text, `${block} reuses the unsampled grey as the status label`).not.toBe(fill);
      }
    }
  });
});

/**
 * A token as a variant paints it: its own value where it declares one, the base
 * theme's where it does not — which is exactly how the cascade resolves it,
 * because a variant is stamped beside `data-theme`, never instead of it.
 */
function resolved(variant: string, base: string, token: string): string {
  const open = css.indexOf("{", blockStart(variant));
  const body = strip(css.slice(open, css.indexOf("}", open)));
  const own = body.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{6});`, "i"));
  return (own?.[1] ?? hexIn(base, token)).toLowerCase();
}

const VARIANTS: { block: string; base: string; floor: number }[] = [
  { block: ':root[data-variant="contrast"] {', base: ":root {", floor: 7 },
  { block: ':root[data-variant="colorblind"] {', base: ":root {", floor: 4.5 },
  { block: ':root[data-variant="oled"] {', base: ':root[data-theme="dark"] {', floor: 4.5 },
];

describe("the theme variants (roadmap 4.18)", () => {
  it("clears its contrast floor for every status word on both grounds", () => {
    for (const { block, base, floor } of VARIANTS) {
      const grounds = ["--color-bg", "--color-surface"].map((token) => resolved(block, base, token));
      for (const token of STATUS_TEXT_TOKENS) {
        const colour = resolved(block, base, token);
        for (const ground of grounds) {
          const ratio = contrast(colour, ground);
          expect(ratio, `${block} ${token} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("holds the high-contrast body text and secondary copy to AAA as well", () => {
    const { block, base } = VARIANTS[0] as (typeof VARIANTS)[number];
    for (const ground of ["--color-bg", "--color-surface"]) {
      for (const token of ["--color-text", "--color-neutral-500", "--color-accent"]) {
        const ratio = contrast(resolved(block, base, token), resolved(block, base, ground));
        expect(ratio, `${token} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("still gives every severity its own colour", () => {
    for (const { block, base } of VARIANTS) {
      const values = STATUS_TEXT_TOKENS.map((token) => resolved(block, base, token));
      expect(new Set(values).size, `${block} paints two severities the same`).toBe(values.length);
    }
  });

  it("does not ask the colour-blind variant to tell red from green", () => {
    const { block, base } = VARIANTS[1] as (typeof VARIANTS)[number];
    const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
    for (const token of ["--status-operational", "--status-operational-fill"]) {
      const [red, green, blue] = channels(resolved(block, base, token));
      expect(blue, `${token} is not blue-dominant`).toBeGreaterThan(Math.max(red, green));
    }
    for (const token of ["--status-major-outage", "--status-major-outage-fill"]) {
      const [, green, blue] = channels(resolved(block, base, token));
      expect(blue, `${token} has no blue in it to tell it from green`).toBeGreaterThan(green);
    }
  });

  it("paints the OLED ground black, so the panel is off behind the content", () => {
    // Every channel zero: black, however it is spelled.
    expect(Number.parseInt(resolved(VARIANTS[2]!.block, VARIANTS[2]!.base, "--color-bg").slice(1), 16)).toBe(0);
  });
});

describe("the inks a custom accent can carry (roadmap 4.19)", () => {
  // lib/accent.ts holds the two inks as channels, for its arithmetic, because
  // the palette scan allows no hex literal outside this file; this is what
  // keeps its copy from drifting away from the one the stylesheet uses.
  it("are the ones lib/accent.ts reasons with", () => {
    const plain = strip(css);
    expect(plain).toContain(`--on-accent-light: ${rgbToHex(LIGHT_INK)};`);
    expect(plain).toContain(`--on-accent-dark: ${rgbToHex(DARK_INK)};`);
  });
});
