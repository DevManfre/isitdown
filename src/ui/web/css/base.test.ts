/// <reference types="node" />
// @vitest-environment node
//
// Same reason as tokens.test.ts: this suite only reads base.css off disk, and
// under the repo's global happy-dom environment Vite would rewrite
// import.meta.url into a dev-server URL that readFileSync cannot open.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./base.css", import.meta.url), "utf8");
// Assertions run against the code, not the prose documenting it.
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("base.css", () => {
  // Both properties or neither: Firefox reads the standard one, Chromium and
  // Safari only the pseudo-element, and shipping one of the two leaves the
  // gutter on half the browsers.
  it("hides the scrollbar on every element, in both engines", () => {
    expect(code).toMatch(/\*\s*\{[^}]*scrollbar-width:\s*none/);
    expect(code).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });

  // Hiding the bar must not cost the scrolling itself, or the operator loses
  // the bottom of every long list instead of just its gutter.
  it("hides the bar without clipping the scroll", () => {
    expect(code).not.toMatch(/\*\s*\{[^}]*overflow:\s*hidden/);
  });

  // Tailwind v4's Preflight sets `cursor: default` on every button, where v3
  // set pointer — which is every action on this dashboard, since each one is a
  // button or a Radix primitive that renders as one. A pointer on a disabled
  // button would be the opposite lie, so the rule has to exclude it.
  it("puts a pointer on what can be clicked, and only while it can be", () => {
    expect(code).toMatch(/button:not\(:disabled\)[^{]*\{[^}]*cursor:\s*pointer/);
  });

  // A role selector here would be dead code: shadcn's select options and menu
  // items carry a `cursor-default` utility, and a utility outranks the base
  // layer regardless of specificity. They are fixed in the primitives.
  it("does not pretend to cover the role-based clickables", () => {
    expect(code).not.toMatch(/\[role="(option|menuitem)"\]/);
  });
});
