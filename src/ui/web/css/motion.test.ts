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

  // The React port carried exactly one of app.css:67-92's rules across — the
  // chevron rotation — and left the four `transition: opacity` / `padding`
  // declarations below animating state changes that no longer happened. The
  // collapsed rail shrank its track to 30px while 196px of fully opaque labels
  // stayed put, with no way to peek at the nav. These assertions are the shape
  // of that whole mechanism, so losing a piece of it fails here rather than in
  // a screenshot nobody takes.
  //
  // The track is no longer a grid this file sizes. `Sidebar` renders its own
  // gap and container and sizes both off --sidebar-width-icon, so the peek is
  // one override of that variable — but it has to stay one that reaches both
  // halves, which is why it is set on the wrapper and not on the strip.
  describe("the collapsed rail keeps its whole collapse mechanism", () => {
    it("animates both halves of the track, which is what the peek resizes", () => {
      const rule = /\[data-slot="sidebar-gap"\],\s*\[data-slot="sidebar-container"\]\s*\{([^}]*)\}/.exec(code);
      expect(rule, "the gap and the container must animate together or the page tears").not.toBeNull();
      expect(rule?.[1]).toMatch(/transition:\s*width/);
    });

    it("peek-expands the track on hover and on keyboard focus", () => {
      expect(code).toContain(':root[data-rail="collapsed"] .console:has(.rail:hover:not(.rail-hold))');
      expect(code).toContain(':root[data-rail="collapsed"] .console:has(.rail:focus-within)');
    });

    // Raising the icon width to the full rail width is the whole peek: the gap
    // and the container both read the variable and both inherit it from here,
    // so the column and the strip widen together and the page gives way instead
    // of being covered. Setting a `width` on the strip alone would cover it.
    it("peek-expands by raising the icon width to the full rail width", () => {
      const rule = /:root\[data-rail="collapsed"\] \.console:has\(\.rail:focus-within\)\s*\{([^}]*)\}/.exec(code);
      expect(rule, "no peek rule on the wrapper").not.toBeNull();
      expect(rule?.[1]).toMatch(/--sidebar-width-icon:\s*var\(--rail-width\)/);
    });

    // Every one of these four has a `transition: opacity` waiting for it in the
    // block above; a class dropped from this list is a label that stays lit at
    // full opacity over the collapsed strip.
    it("fades all four content groups while collapsed and unhovered", () => {
      const rule = /:root\[data-rail="collapsed"\][^{]*:is\(([^)]*)\)[^{]*\{[^}]*opacity:\s*0/.exec(code);
      expect(rule, "no opacity:0 rule for the collapsed rail's content").not.toBeNull();
      for (const cls of [".rail-dot", ".rail-name", ".rail-links", ".rail-foot"]) {
        expect(rule?.[1], `${cls} stays opaque over the collapsed strip`).toContain(cls);
      }
    });

    it("keeps the .rail-hold guard on both the fade and the width", () => {
      expect(code).toContain(".rail.rail-hold");
      expect(code).toContain(":not(.rail-hold)");
    });

    it("shifts the brand padding in, which is what `transition: padding` animates", () => {
      expect(code).toMatch(/:root\[data-rail="collapsed"\][^{]*\.rail-brand[^{]*\{[^}]*padding-left:/);
    });

    // The span carries Tailwind's `rotate-45`, which sets the standalone
    // `rotate` property. A `transform: rotate(...)` flip here would compose
    // with it rather than replace it, so the flip has to ride `rotate` too.
    it("still flips the pin chevron, on the property `rotate-45` sets", () => {
      const rule = /:root\[data-rail="collapsed"\]\s+\.rail-toggle-chevron\s*\{([^}]*)\}/.exec(code);
      expect(rule, "no collapsed rule for the pin chevron").not.toBeNull();
      expect(rule?.[1]).toMatch(/\brotate:\s*225deg/);
      expect(rule?.[1], "a transform flip would compose with rotate-45").not.toMatch(/transform:/);
    });
  });
});
