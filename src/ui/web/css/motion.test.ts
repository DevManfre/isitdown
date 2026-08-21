/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./motion.css", import.meta.url), "utf8");

// Comments are documentation, not rules: a selector or class name mentioned
// in prose (explaining what a rule replaced, or why a property is kept)
// must not satisfy a positive assertion, and must not trip a negative one.
// Every assertion below scans this comment-stripped text instead of the raw
// file, so only live CSS counts.
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("motion.css after the react port", () => {
  it("keeps the entry-animation gate on #view[data-animate]", () => {
    for (const cls of ["anim-rise", "anim-fade", "anim-sweep", "anim-ring", "anim-bar"]) {
      expect(code).toContain(`#view[data-animate] .${cls}`);
    }
  });

  it("drops the vanilla repaint hack", () => {
    expect(code).not.toContain("anim-quiet");
  });

  it("hangs the dialog choreography off radix data attributes", () => {
    expect(code).toMatch(/\[data-slot="dialog-overlay"\]\[data-state="open"\]/);
    expect(code).toMatch(/\[data-slot="dialog-content"\]\[data-state="open"\]/);
    expect(code).toMatch(/\[data-slot="dialog-overlay"\]\[data-state="closed"\]/);
    expect(code).not.toContain("dialog-backdrop");
  });

  it("references no class that nocturne.css or app.css used to own", () => {
    for (const dead of [".btn-primary", ".btn-ghost", ".btn-danger", ".seg-opt", ".tag-outline", ".table tbody"]) {
      expect(code, `${dead} lost its stylesheet in this port`).not.toContain(dead);
    }
  });

  it("keeps every keyframe the entry animations name", () => {
    for (const frames of ["rise", "fade", "sweep", "ring-in", "bar-grow", "modal-in", "modal-out", "fade-out", "pulse"]) {
      expect(code).toContain(`@keyframes ${frames}`);
    }
  });

  it("contains no colour literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
