import { AnimatePresence } from "motion/react";
import type { PointerEvent } from "react";
import type { WidgetConfig } from "../../../dashboardLayout.ts";
import type { DraftAction } from "../layoutDraft.ts";
import { FilterPanel } from "./FilterPanel.tsx";
import { ProviderPanel } from "./ProviderPanel.tsx";
import { Reveal } from "./Reveal.tsx";
import { WidgetToolbar } from "./WidgetToolbar.tsx";

/**
 * Edit mode's chrome above one widget: the toolbar, and the filter under it
 * when open. Both unfold, so the widget below slides down to make room rather
 * than jumping by a toolbar's height — and fold back the same way on close.
 */
export default function CellChrome({
  widget,
  index,
  total,
  closing,
  filterText,
  filterOpen,
  dispatch,
  onToggleFilter,
  startDrag,
}: {
  widget: WidgetConfig;
  index: number;
  total: number;
  closing: boolean;
  filterText: string | null;
  filterOpen: boolean;
  dispatch: (action: DraftAction) => void;
  onToggleFilter: () => void;
  startDrag: (event: PointerEvent) => void;
}) {
  const filter = "filter" in widget.props ? widget.props.filter : null;
  const panelId = `widget-filter-${widget.id}`;
  return (
    <Reveal open={!closing}>
      <WidgetToolbar
        widget={widget}
        index={index}
        total={total}
        filterText={filterText}
        filterOpen={filterOpen}
        filterPanelId={panelId}
        dispatch={dispatch}
        onToggleFilter={onToggleFilter}
        onGripPointerDown={(event) => startDrag(event)}
      />
      <AnimatePresence initial={false}>
        {filter !== null && filterOpen && (
          <Reveal key="filter">
            <FilterPanel id={panelId} widgetId={widget.id} filter={filter} dispatch={dispatch} />
          </Reveal>
        )}
        {"provider" in widget.props && filterOpen && (
          <Reveal key="provider">
            <ProviderPanel id={panelId} widgetId={widget.id} provider={widget.props.provider} dispatch={dispatch} />
          </Reveal>
        )}
      </AnimatePresence>
      <div className="h-3" />
    </Reveal>
  );
}
