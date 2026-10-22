import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, MAX_WIDGETS, type DashboardLayout } from "../../dashboardLayout.ts";
import { applyDraft, isDirty, startDraft, type DraftAction } from "./layoutDraft.ts";

const ids = (layout: DashboardLayout) => layout.widgets.map((w) => w.id);
const start = () => startDraft(DEFAULT_LAYOUT);

describe("applyDraft", () => {
  const moves: { name: string; action: Extract<DraftAction, { type: "move" | "moveTo" }>; order: string[]; position: number }[] = [
    { name: "up one", action: { type: "move", id: "stack", delta: -1 }, order: ["rings", "map", "stack", "shared", "fleet"], position: 3 },
    { name: "down one", action: { type: "move", id: "rings", delta: 1 }, order: ["map", "rings", "shared", "stack", "fleet"], position: 2 },
    { name: "to an index", action: { type: "moveTo", id: "fleet", index: 0 }, order: ["fleet", "rings", "map", "shared", "stack"], position: 1 },
    { name: "past the end, clamped", action: { type: "moveTo", id: "rings", index: 99 }, order: ["map", "shared", "stack", "fleet", "rings"], position: 5 },
  ];
  for (const { name, action, order, position } of moves) {
    it(`moves a widget ${name}, announces where it landed and keeps focus on it`, () => {
      const result = applyDraft(start(), action);
      expect(ids(result.state.layout)).toEqual(order);
      expect(result.announcement).toEqual({ key: "dashboard.announce.moved", widget: action.id, values: { position, total: 5 } });
      expect(result.focus).toEqual({ grip: action.id });
      expect(result.state.revision).toBe(1);
    });
  }

  it("does nothing, and says nothing, when a move would leave the list", () => {
    const result = applyDraft(start(), { type: "move", id: "rings", delta: -1 });
    expect(ids(result.state.layout)).toEqual(ids(DEFAULT_LAYOUT));
    expect(result.announcement).toBeNull();
    expect(result.state.revision).toBe(0);
  });

  it("sets an allowed width and refuses one the widget cannot take", () => {
    const half = applyDraft(start(), { type: "setWidth", id: "map", width: "half" });
    expect(half.state.layout.widgets[1]?.width).toBe("half");
    expect(half.announcement).toEqual({ key: "dashboard.announce.width", widget: "map", values: { width: "half" } });

    const third = applyDraft(start(), { type: "setWidth", id: "map", width: "third" });
    expect(third.state.layout.widgets[1]?.width).toBe("full");
    expect(third.state.revision).toBe(0);
  });

  it("removes a widget and hands focus to the one that took its place", () => {
    const result = applyDraft(start(), { type: "remove", id: "map" });
    expect(ids(result.state.layout)).toEqual(["rings", "shared", "stack", "fleet"]);
    expect(result.announcement).toEqual({ key: "dashboard.announce.removed", widget: "map", values: {} });
    expect(result.focus).toEqual({ grip: "shared" });
  });

  it("hands focus to the previous widget when the last one goes, and to Add when none is left", () => {
    expect(applyDraft(start(), { type: "remove", id: "fleet" }).focus).toEqual({ grip: "stack" });
    let state = startDraft({ version: 1, widgets: [DEFAULT_LAYOUT.widgets[1]!] });
    const result = applyDraft(state, { type: "remove", id: "map" });
    state = result.state;
    expect(state.layout.widgets).toEqual([]);
    expect(result.focus).toEqual({ add: true });
  });

  it("adds a widget at the end, full width, whole fleet, with an id of its own", () => {
    const first = applyDraft(start(), { type: "add", widgetType: "fleet-list" });
    const second = applyDraft(first.state, { type: "add", widgetType: "fleet-list" });
    const added = second.state.layout.widgets.slice(-2);
    expect(added.map((w) => [w.type, w.width, w.props])).toEqual([
      ["fleet-list", "full", { filter: { groups: [], providers: [] } }],
      ["fleet-list", "full", { filter: { groups: [], providers: [] } }],
    ]);
    expect(new Set(ids(second.state.layout)).size).toBe(7);
    expect(second.announcement).toEqual({ key: "dashboard.announce.added", widget: added[1]!.id, values: { position: 7, total: 7 } });
    expect(second.focus).toEqual({ grip: added[1]!.id });
  });

  it("refuses to add past the cap and says why", () => {
    const full = startDraft({
      version: 1,
      widgets: Array.from({ length: MAX_WIDGETS }, (_, i) => ({ id: `s${i}`, type: "shared-failure" as const, width: "full" as const, props: {} })),
    });
    const result = applyDraft(full, { type: "add", widgetType: "geo-map" });
    expect(result.state.layout.widgets).toHaveLength(MAX_WIDGETS);
    expect(result.announcement).toEqual({ key: "dashboard.announce.full", widget: null, values: { max: MAX_WIDGETS } });
  });

  it("toggles a group or a provider in a fleet widget's filter", () => {
    const on = applyDraft(start(), { type: "toggleFilter", id: "fleet", field: "groups", value: "cloud" });
    expect(on.state.layout.widgets[4]?.props).toEqual({ filter: { groups: ["cloud"], providers: [] } });
    expect(on.announcement).toEqual({ key: "dashboard.announce.filter", widget: "fleet", values: {} });
    const off = applyDraft(on.state, { type: "toggleFilter", id: "fleet", field: "groups", value: "cloud" });
    expect(off.state.layout.widgets[4]?.props).toEqual({ filter: { groups: [], providers: [] } });
    // A widget with no filter is left alone.
    expect(applyDraft(start(), { type: "toggleFilter", id: "map", field: "groups", value: "cloud" }).state.revision).toBe(0);
  });

  it("replaces the whole draft — Load theirs, or the default on reset", () => {
    const moved = applyDraft(start(), { type: "move", id: "rings", delta: 1 }).state;
    const result = applyDraft(moved, { type: "replace", layout: DEFAULT_LAYOUT });
    expect(ids(result.state.layout)).toEqual(ids(DEFAULT_LAYOUT));
    expect(result.state.revision).toBe(2);
  });

  it("never mutates the layout it was given", () => {
    const state = start();
    const before = JSON.stringify(state);
    applyDraft(state, { type: "remove", id: "rings" });
    applyDraft(state, { type: "toggleFilter", id: "fleet", field: "providers", value: "github" });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("isDirty", () => {
  it("is false for an untouched draft and for one moved back where it was", () => {
    const there = applyDraft(start(), { type: "move", id: "rings", delta: 1 }).state;
    const back = applyDraft(there, { type: "move", id: "rings", delta: -1 }).state;
    expect(isDirty(DEFAULT_LAYOUT, start().layout)).toBe(false);
    expect(isDirty(DEFAULT_LAYOUT, there.layout)).toBe(true);
    expect(isDirty(DEFAULT_LAYOUT, back.layout)).toBe(false);
  });
});
