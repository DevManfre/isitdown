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

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  return [...css.slice(open, close).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string).sort();
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
    expect(css).not.toMatch(/--bar-/);
  });

  it("binds the dark variant to the data-theme attribute, not a class", () => {
    expect(css).toMatch(/@custom-variant\s+dark\s*\(&:where\(\[data-theme="dark"\]/);
    expect(css).not.toMatch(/@custom-variant\s+dark\s*\(&:is\(\.dark/);
  });
});
