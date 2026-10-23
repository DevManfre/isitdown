import type { KeyboardEvent, PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ChevronDown, ChevronUp, GripVertical, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { WIDGETS } from "@/widgets/registry.tsx";
import { WIDTHS, type Width, type WidgetConfig } from "../../../dashboardLayout.ts";
import type { DraftAction } from "../layoutDraft.ts";
import { EASE_ENTRY } from "./Reveal.tsx";
import { WIDTH_KEYS } from "../widths.ts";

/** Narrow first, the order a widget grows in. */
const WIDTH_ORDER: readonly Width[] = [...WIDTHS].reverse();

/**
 * The strip above each widget in edit mode: grip, up/down, name and filter,
 * width, filter toggle, remove. The grip is a real button so keyboard users
 * reorder with the arrows; the up/down pair is the same move for a pointer
 * that would rather click than drag.
 */
export function WidgetToolbar({
  widget,
  index,
  total,
  filterText,
  filterOpen,
  filterPanelId,
  dispatch,
  onToggleFilter,
  onGripPointerDown,
}: {
  widget: WidgetConfig;
  index: number;
  total: number;
  filterText: string | null;
  filterOpen: boolean;
  filterPanelId: string;
  dispatch: (action: DraftAction) => void;
  onToggleFilter: () => void;
  onGripPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const def = WIDGETS[widget.type];
  const name = t(def.titleKey);

  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const action: DraftAction | null =
      event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? { type: "move", id: widget.id, delta: -1 }
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? { type: "move", id: widget.id, delta: 1 }
          : event.key === "Home"
            ? { type: "moveTo", id: widget.id, index: 0 }
            : event.key === "End"
              ? { type: "moveTo", id: widget.id, index: total - 1 }
              : null;
    if (action === null) return;
    event.preventDefault();
    dispatch(action);
  };

  return (
    <div
      data-slot="widget-toolbar"
      className="flex flex-wrap items-center gap-1 border-b border-dashed border-border pb-1.5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-grip={widget.id}
        aria-label={t("dashboard.move", { widget: name })}
        aria-describedby="dashboard-move-hint"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        onKeyDown={onGripKey}
        onPointerDown={onGripPointerDown}
      >
        <GripVertical aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("dashboard.move-up", { widget: name })}
        disabled={index === 0}
        onClick={() => dispatch({ type: "move", id: widget.id, delta: -1 })}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("dashboard.move-down", { widget: name })}
        disabled={index === total - 1}
        onClick={() => dispatch({ type: "move", id: widget.id, delta: 1 })}
      >
        <ChevronDown aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-[1_1_8rem] flex-col pl-1">
        <span className="truncate text-sm font-medium">{name}</span>
        {filterText !== null && (
          <span className="truncate font-mono text-xs text-muted-foreground">{filterText}</span>
        )}
      </div>

      <ToggleGroup
        type="single"
        size="sm"
        aria-label={t("dashboard.width.label")}
        className="max-md:hidden"
        value={widget.width}
        onValueChange={(value) => {
          // Radix answers "" when the pressed item is pressed again; a widget
          // always has a width, so that click is not a change.
          if (value !== "") dispatch({ type: "setWidth", id: widget.id, width: value as Width });
        }}
      >
        {WIDTH_ORDER.map((width) => (
          <ToggleGroupItem
            key={width}
            value={width}
            aria-label={t(WIDTH_KEYS[width].label)}
            disabled={!def.widths.includes(width)}
            className="relative isolate min-w-8 px-2 font-mono text-xs data-[state=on]:bg-transparent"
          >
            {/* One pill per widget that slides to the chosen width, instead of
                one segment switching off as another switches on. */}
            {widget.width === width && (
              <motion.span
                aria-hidden="true"
                layoutId={`width-pill-${widget.id}`}
                className="absolute inset-0 -z-10 rounded-md bg-accent"
                transition={{ duration: 0.2, ease: EASE_ENTRY }}
              />
            )}
            {t(WIDTH_KEYS[width].short)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {def.props !== "none" && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(def.props === "fleet" ? "dashboard.filter.button" : "dashboard.provider.button", { widget: name })}
          aria-expanded={filterOpen}
          aria-controls={filterPanelId}
          className="aria-expanded:bg-accent aria-expanded:text-accent-foreground"
          onClick={onToggleFilter}
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("dashboard.remove", { widget: name })}
        onClick={() => dispatch({ type: "remove", id: widget.id })}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
