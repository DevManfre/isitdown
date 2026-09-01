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

  // A leave is not an entry: it fires on a class swap on a row already on the
  // page, so gating it on the remount attribute would keep it from ever running.
  it("keeps the row exit animation outside that gate", () => {
    expect(code).toContain("@keyframes sink");
    expect(code).toMatch(/(^|\n)\.anim-sink \{/);
    expect(code).not.toContain("#view[data-animate] .anim-sink");
  });

  // The shift that closes the gap under a dropped row is set inline on the row,
  // which an `animation-fill-mode: both` entry animation would outrank on
  // `transform` — so it rides `translate`, and this is the transition that
  // makes the ranks close rather than jump.
  it("transitions a table row on `translate`, and still on background", () => {
    const rule = /\[data-slot="table-row"\]\s*\{([^}]*)\}/.exec(code);
    expect(rule, "no transition rule for table rows").not.toBeNull();
    expect(rule?.[1]).toMatch(/\btranslate\s+[\d.]+s/);
    expect(rule?.[1], "the row's own background fade must survive it").toMatch(/\bbackground\s+[\d.]+s/);
  });

  // ViewFrame withholds `data-animate` until the view's first data has landed,
  // so the gate is also what holds the page still. Without this rule the view
  // would simply render un-animated during that stretch — visible, then
  // suddenly animating from nothing.
  it("holds a view that has not been stamped yet", () => {
    const rule = /#view:not\(\[data-animate\]\)\s*\{([^}]*)\}/.exec(code);
    expect(rule, "no hold rule for a view with nothing to show yet").not.toBeNull();
    expect(rule?.[1]).toMatch(/visibility:\s*hidden/);
  });

  // Entries share one curve so a staggered cascade reads as a single movement;
  // hover and press keep --ease-out, where a long tail feels unresponsive.
  it("runs every entry animation on the entry curve", () => {
    for (const frame of ["view-in", "rise", "fade", "sweep", "ring-in", "bar-grow"]) {
      const rule = new RegExp(`animation: ${frame} [\\d.]+s var\\(--ease-entry\\)`);
      expect(code, `${frame} is an entry animation`).toMatch(rule);
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

  // The rail is pinned open now: no pin, no chevron, no peek widening a
  // collapsed strip. Nothing here may animate a state that cannot happen.
  it("keeps no trace of the collapse mechanism the rail no longer has", () => {
    for (const dead of ['[data-rail="collapsed"]', ".rail-toggle", ".rail-hold"]) {
      expect(code, `${dead} outlived the rail's collapse control`).not.toContain(dead);
    }
  });
});
