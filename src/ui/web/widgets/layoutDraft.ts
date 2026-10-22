import {
  MAX_WIDGETS,
  WIDGET_WIDTHS,
  type DashboardLayout,
  type FleetFilter,
  type Width,
  type WidgetConfig,
  type WidgetType,
} from "../../dashboardLayout.ts";

/**
 * Edit mode's draft of the Overview — roadmap 4.1.
 *
 * A pure function of (draft, action), so every edit can be tested without a
 * DOM. It also says what a screen reader should hear and where focus goes next,
 * because both depend on the result of the edit, not on the click that asked
 * for it: a move at the end of the list does nothing and must announce nothing.
 *
 * `revision` counts the edits that changed something. The grid animates layout
 * only when it moves — never when a poll reshapes a widget's content.
 */
export interface DraftState {
  layout: DashboardLayout;
  revision: number;
}

export type DraftAction =
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "moveTo"; id: string; index: number }
  | { type: "setWidth"; id: string; width: Width }
  | { type: "remove"; id: string }
  | { type: "add"; widgetType: WidgetType }
  | { type: "toggleFilter"; id: string; field: keyof FleetFilter; value: string }
  | { type: "replace"; layout: DashboardLayout };

export interface Announcement {
  key: string;
  /** The widget the sentence is about, by id — the view names it. */
  widget: string | null;
  values: Record<string, string | number>;
}

export type Focus = { grip: string } | { add: true };

export interface DraftResult {
  state: DraftState;
  announcement: Announcement | null;
  focus: Focus | null;
}

export function startDraft(layout: DashboardLayout): DraftState {
  return { layout, revision: 0 };
}

export function isDirty(saved: DashboardLayout, draft: DashboardLayout): boolean {
  return JSON.stringify(saved) !== JSON.stringify(draft);
}

const unchanged = (state: DraftState): DraftResult => ({ state, announcement: null, focus: null });

function changed(state: DraftState, widgets: WidgetConfig[], announcement: Announcement | null, focus: Focus | null): DraftResult {
  return { state: { layout: { ...state.layout, widgets }, revision: state.revision + 1 }, announcement, focus };
}

function moveTo(state: DraftState, id: string, target: number): DraftResult {
  const widgets = [...state.layout.widgets];
  const from = widgets.findIndex((w) => w.id === id);
  const to = Math.max(0, Math.min(widgets.length - 1, target));
  if (from < 0 || from === to) return unchanged(state);
  const [widget] = widgets.splice(from, 1);
  widgets.splice(to, 0, widget!);
  return changed(
    state,
    widgets,
    { key: "dashboard.announce.moved", widget: id, values: { position: to + 1, total: widgets.length } },
    { grip: id },
  );
}

function freshId(type: WidgetType, widgets: readonly WidgetConfig[]): string {
  const taken = new Set(widgets.map((w) => w.id));
  let n = 1;
  while (taken.has(`${type}-${n}`)) n += 1;
  return `${type}-${n}`;
}

function newWidget(type: WidgetType, id: string): WidgetConfig {
  switch (type) {
    case "geo-map":
    case "shared-failure":
      return { id, type, width: "full", props: {} };
    default:
      return { id, type, width: "full", props: { filter: { groups: [], providers: [] } } };
  }
}

export function applyDraft(state: DraftState, action: DraftAction): DraftResult {
  const widgets = state.layout.widgets;
  switch (action.type) {
    case "move": {
      const index = widgets.findIndex((w) => w.id === action.id);
      const target = index + action.delta;
      if (index < 0 || target < 0 || target >= widgets.length) return unchanged(state);
      return moveTo(state, action.id, target);
    }
    case "moveTo":
      return moveTo(state, action.id, action.index);
    case "setWidth": {
      const widget = widgets.find((w) => w.id === action.id);
      if (widget === undefined || widget.width === action.width) return unchanged(state);
      if (!(WIDGET_WIDTHS[widget.type] as readonly Width[]).includes(action.width)) return unchanged(state);
      return changed(
        state,
        widgets.map((w) => (w.id === action.id ? { ...w, width: action.width } : w)),
        { key: "dashboard.announce.width", widget: action.id, values: { width: action.width } },
        null,
      );
    }
    case "remove": {
      const index = widgets.findIndex((w) => w.id === action.id);
      if (index < 0) return unchanged(state);
      const rest = widgets.filter((w) => w.id !== action.id);
      const next = rest[index] ?? rest[index - 1];
      return changed(
        state,
        rest,
        { key: "dashboard.announce.removed", widget: action.id, values: {} },
        next === undefined ? { add: true } : { grip: next.id },
      );
    }
    case "add": {
      if (widgets.length >= MAX_WIDGETS) {
        return { state, announcement: { key: "dashboard.announce.full", widget: null, values: { max: MAX_WIDGETS } }, focus: null };
      }
      const widget = newWidget(action.widgetType, freshId(action.widgetType, widgets));
      const next = [...widgets, widget];
      return changed(
        state,
        next,
        { key: "dashboard.announce.added", widget: widget.id, values: { position: next.length, total: next.length } },
        { grip: widget.id },
      );
    }
    case "toggleFilter": {
      const widget = widgets.find((w) => w.id === action.id);
      if (widget === undefined || !("filter" in widget.props)) return unchanged(state);
      const list = widget.props.filter[action.field];
      const filter = {
        ...widget.props.filter,
        [action.field]: list.includes(action.value) ? list.filter((v) => v !== action.value) : [...list, action.value],
      };
      return changed(
        state,
        widgets.map((w) => (w.id === action.id ? ({ ...w, props: { filter } } as WidgetConfig) : w)),
        { key: "dashboard.announce.filter", widget: action.id, values: {} },
        null,
      );
    }
    case "replace":
      return changed(state, action.layout.widgets, null, null);
  }
}
