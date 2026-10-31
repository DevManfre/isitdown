import { describe, expect, it } from "vitest";
import { createShortcutMatcher, isTyping, SEQUENCE_MS, SHORTCUTS, type KeyInput } from "./shortcuts.ts";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: "BODY" },
  ...extra,
});

describe("the shortcut matcher", () => {
  it("goes where a g sequence says", () => {
    const feed = createShortcutMatcher();
    expect(feed(press("g"), 0)).toBeNull();
    expect(feed(press("i"), 100)).toEqual({ kind: "go", to: "/incidents" });
    expect(feed(press("g"), 200)).toBeNull();
    expect(feed(press("h"), 300)).toEqual({ kind: "go", to: "/history" });
    expect(feed(press("g"), 400)).toBeNull();
    expect(feed(press("o"), 500)).toEqual({ kind: "go", to: "/overview" });
  });

  it("does one thing for each bare key", () => {
    const feed = createShortcutMatcher();
    expect(feed(press("/"), 0)).toEqual({ kind: "search" });
    expect(feed(press("p"), 1)).toEqual({ kind: "poll" });
    expect(feed(press("?", { }), 2)).toEqual({ kind: "help" });
  });

  it("reads a capital as the same letter, so caps lock does not break a sequence", () => {
    const feed = createShortcutMatcher();
    feed(press("G"), 0);
    expect(feed(press("I"), 10)).toEqual({ kind: "go", to: "/incidents" });
  });

  it("forgets a g that waited too long", () => {
    const feed = createShortcutMatcher();
    feed(press("g"), 0);
    // `i` alone is not a shortcut, so a stale g must not complete it.
    expect(feed(press("i"), SEQUENCE_MS + 1)).toBeNull();
  });

  it("cancels the sequence on a key that is not its partner, without running that key", () => {
    const feed = createShortcutMatcher();
    feed(press("g"), 0);
    expect(feed(press("p"), 10)).toEqual({ kind: "go", to: "/providers" });
    feed(press("g"), 20);
    // `x` is nobody's partner: the sequence ends, and `p` after it is a poll again.
    expect(feed(press("x"), 30)).toBeNull();
    expect(feed(press("p"), 40)).toEqual({ kind: "poll" });
  });

  it("leaves chords to the browser and the palette", () => {
    const feed = createShortcutMatcher();
    expect(feed(press("p", { ctrlKey: true }), 0)).toBeNull();
    expect(feed(press("p", { metaKey: true }), 1)).toBeNull();
    expect(feed(press("/", { altKey: true }), 2)).toBeNull();
  });

  it.each([["INPUT"], ["TEXTAREA"], ["SELECT"]])("stays out of a %s", (tagName) => {
    const feed = createShortcutMatcher();
    expect(feed(press("p", { target: { tagName } }), 0)).toBeNull();
    expect(feed(press("/", { target: { tagName } }), 1)).toBeNull();
  });

  it("stays out of an editable element and of an ARIA text role", () => {
    const feed = createShortcutMatcher();
    expect(feed(press("p", { target: { tagName: "DIV", isContentEditable: true } }), 0)).toBeNull();
    expect(feed(press("p", { target: { tagName: "DIV", getAttribute: () => "combobox" } }), 1)).toBeNull();
  });

  it("drops a half-typed sequence when it is blocked, rather than finishing it behind a dialog", () => {
    const feed = createShortcutMatcher();
    feed(press("g"), 0);
    expect(feed(press("i"), 10, true)).toBeNull();
    expect(feed(press("i"), 20)).toBeNull();
  });
});

describe("the shortcut table", () => {
  it("gives no two shortcuts the same keys", () => {
    const seen = SHORTCUTS.map((entry) => entry.keys.join(" "));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("never lists a bare key that is also the start of a sequence", () => {
    expect(SHORTCUTS.some((entry) => entry.keys.length === 1 && entry.keys[0] === "g")).toBe(false);
  });
});

describe("isTyping", () => {
  it("is false for no target at all", () => expect(isTyping(null)).toBe(false));
});
