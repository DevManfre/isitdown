import { Component, Fragment, memo, useRef, useState, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from "react";
import { AnimatePresence, motion, MotionConfig, useDragControls } from "motion/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useStatus } from "@/hooks/queries.ts";
import type { StatusResponse } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";
import { WIDGETS } from "@/widgets/registry.tsx";
import { dropIndex, readSlots } from "@/widgets/gridDrag.ts";
import type { DashboardLayout, FleetFilter, Width, WidgetConfig } from "../../dashboardLayout.ts";
import { useStill } from "@/lib/still.ts";

/**
 * Six columns, so each width is a whole number of tracks; below `md` every
 * widget takes the row, since a third of a phone is a column of one word.
 */
export const SPAN: Record<Width, string> = {
  full: "col-span-6",
  "two-thirds": "col-span-6 md:col-span-4",
  half: "col-span-6 md:col-span-3",
  third: "col-span-6 md:col-span-2",
};

/**
 * One broken widget must not take the Overview with it. React only catches
 * render errors in a class component, so this is the one class in the tree.
 */
class WidgetBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("dashboard widget failed to render", error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return <WidgetError error={this.state.error} retry={() => this.setState({ error: null })} />;
  }
}

function WidgetError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-[var(--status-outage-border)] p-4"
    >
      <p className="text-sm text-muted-foreground">
        {t("dashboard.widget-error", { error: error instanceof Error ? error.message : String(error) })}
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={retry}>
        {t("action.retry")}
      </Button>
    </div>
  );
}

/**
 * "Cloud · Stripe", with a name the fleet no longer has marked as removed, or
 * "Whole fleet" for no filter at all.
 */
export function filterLabel(filter: FleetFilter, status: StatusResponse | undefined, t: TFunction): string {
  const groups = new Set((status?.groups ?? []).map((group) => group.id));
  const providers = new Map((status?.providers ?? []).map((p) => [p.id, p.name]));
  const names = [
    ...filter.groups.map((id) => (groups.has(id) ? id : t("dashboard.filter.removed", { name: id }))),
    ...filter.providers.map((id) => providers.get(id) ?? t("dashboard.filter.removed", { name: id })),
  ];
  return names.length === 0 ? t("dashboard.filter.all") : names.join(" · ");
}

export function useFilterLabel(filter: FleetFilter): string {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  return filterLabel(filter, status, t);
}

function Caption({ widget, filter }: { widget: WidgetConfig; filter: FleetFilter }) {
  const { t } = useTranslation();
  const label = useFilterLabel(filter);
  return (
    <div data-slot="widget-caption" className="mb-2.5 flex items-baseline gap-2">
      <span className="text-sm font-medium">{t(WIDGETS[widget.type].titleKey)}</span>
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function filterOf(widget: WidgetConfig): FleetFilter | null {
  return "filter" in widget.props ? widget.props.filter : null;
}

function WidgetRender({ widget }: { widget: WidgetConfig }) {
  // The registry is keyed by the same union the layout is, so each entry's
  // Component takes exactly its own widget's props.
  const { Component: Body } = WIDGETS[widget.type] as unknown as {
    Component: (p: { props: WidgetConfig["props"] }) => ReactNode;
  };
  return <Body props={widget.props} />;
}

/**
 * A widget inside its own error boundary: one broken widget stays in its cell.
 *
 * Memoised on the widget's config, which an edit leaves untouched for every
 * widget it does not change: moving one widget must not re-render ninety day
 * bars in each of the others, or the frame that starts the glide arrives late
 * and the spring has already run most of its course before it is painted.
 */
export const WidgetBody = memo(function WidgetBody({ widget }: { widget: WidgetConfig }) {
  return (
    <WidgetBoundary>
      <WidgetRender widget={widget} />
    </WidgetBoundary>
  );
});

/** What a cell needs from edit mode; absent, the grid is the plain Overview. */
export interface GridEditing {
  /** Bumped by every edit, and only by edits: the one thing that may animate layout. */
  revision: number;
  closing: boolean;
  entering: string | null;
  arrived: string | null;
  /** The toolbar and filter of one widget — edit mode's own. */
  renderChrome: (cell: { widget: WidgetConfig; index: number; total: number; startDrag: (event: ReactPointerEvent) => void }) => ReactNode;
  onDragTo: (id: string, index: number) => void;
  /** Labels the list for assistive tech. */
  label: string;
}

/**
 * Reorder moves glide on a critically damped spring: no overshoot (a widget
 * landing past its slot and coming back reads as a mistake), and a spring
 * because a second press mid-glide must carry on from where the widget is.
 */
export const REORDER_SPRING = { type: "spring", duration: 0.32, bounce: 0 } as const;

function GridCell({
  widget,
  index,
  total,
  edit,
  grid,
  ref,
}: {
  widget: WidgetConfig;
  index: number;
  total: number;
  edit: GridEditing | null;
  grid: RefObject<HTMLDivElement | null>;
  /** AnimatePresence's `popLayout` measures the leaving cell through this, to lift it out of the flow at once. */
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const reduce = useStill();
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  /** Where a drag started, for Escape to put the widget back. */
  const origin = useRef<number | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const editing = edit !== null;
  const filter = filterOf(widget);
  const filtered = filter !== null && (filter.groups.length > 0 || filter.providers.length > 0);
  const entering = edit?.entering === widget.id && !reduce;

  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || origin.current === null || edit === null) return;
    edit.onDragTo(widget.id, origin.current);
    origin.current = null;
  };

  return (
    <motion.div
      ref={ref}
      role={editing ? "listitem" : undefined}
      data-slot="widget-cell"
      data-widget={widget.type}
      data-tour="tile"
      // Position only: animating the size too would stretch every chart and
      // line of text inside for the length of the glide. Decided at mount,
      // because motion only builds a cell's projection then — and remounting
      // is what edit mode must not do. With motion stilled there is nothing to
      // glide, so no projection at all: every move simply lands.
      //
      // In edit mode the cell is draggable, and motion measures a draggable
      // element on every render whatever `layoutDependency` says, so a toolbar
      // unfolding or a poll reshaping a widget moves its neighbours on the same
      // spring as an edit does — continuous, rather than a jump.
      layout={reduce ? false : "position"}
      layoutDependency={edit?.revision ?? 0}
      transition={{ layout: REORDER_SPRING }}
      // Drag and layout both drive this element's transform, so it is moved by
      // motion's own channels rather than a transform string that would
      // overwrite theirs.
      initial={entering ? { opacity: 0, y: 12, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] } }}
      exit={{ opacity: 0, scale: reduce ? 1 : 0.97, transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] } }}
      drag={editing}
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragSnapToOrigin
      dragElastic={0}
      dragTransition={{ bounceStiffness: 520, bounceDamping: 44 }}
      whileDrag={{ scale: 1.02 }}
      onDragStart={() => {
        origin.current = indexRef.current;
        setDragging(true);
        window.addEventListener("keydown", cancelOnEscape);
      }}
      onDrag={(_, info) => {
        if (origin.current === null || edit === null) return;
        const box = grid.current?.getBoundingClientRect();
        if (box === undefined) return;
        const cells = [...(grid.current?.querySelectorAll<HTMLElement>("[data-slot=widget-cell]") ?? [])];
        const point = { x: info.point.x - window.scrollX - box.left, y: info.point.y - window.scrollY - box.top };
        const target = dropIndex(readSlots(cells), point, indexRef.current);
        if (target !== indexRef.current) edit.onDragTo(widget.id, target);
      }}
      onDragEnd={() => {
        origin.current = null;
        setDragging(false);
        window.removeEventListener("keydown", cancelOnEscape);
      }}
      className={cn(
        "relative isolate min-w-0",
        !editing && "has-[[data-slot=widget-body]:empty]:hidden",
        dragging && "z-20 cursor-grabbing",
        SPAN[widget.width],
      )}
    >
      {/* The frame sits outside the cell's box, in the row gap, so the widget
          itself stays exactly where view mode drew it. */}
      <AnimatePresence initial={false}>
        {editing && !edit.closing && (
          <motion.span
            key="frame"
            aria-hidden="true"
            data-slot="edit-frame"
            className={cn(
              "pointer-events-none absolute -inset-1.5 -z-10 rounded-xl border border-dashed border-primary/50 bg-card/30 transition-shadow duration-150",
              dragging && "border-solid bg-card shadow-xl",
            )}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] } }}
          />
        )}
      </AnimatePresence>
      {edit?.arrived === widget.id && (
        <span aria-hidden="true" data-slot="edit-arrival" className="pointer-events-none absolute -inset-1.5 rounded-xl ring-2 ring-primary" />
      )}
      <div data-slot="cell-inner" className="-m-1 min-h-0 p-1">
        {/* Its own presence: the grid's `initial={false}` (no entry for the
            widgets already on the page) would otherwise reach down and stop
            the chrome from unfolding when edit mode opens. */}
        <AnimatePresence>
          {editing && (
            <Fragment key="chrome">
              {edit.renderChrome({ widget, index, total, startDrag: (e) => controls.start(e) })}
            </Fragment>
          )}
        </AnimatePresence>
        {!editing && filtered && <Caption key="caption" widget={widget} filter={filter} />}
        <div key="body" data-slot="widget-body" className="peer">
          <WidgetBody widget={widget} />
        </div>
        {/* A widget with nothing to draw today still has to be movable, so in
            edit mode its empty body says why. */}
        {editing && (
          <p
            key="idle"
            data-slot="widget-idle"
            className="hidden rounded-lg border border-dashed border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground peer-empty:block"
          >
            {t(WIDGETS[widget.type].idleKey)}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The composable part of the Overview — roadmap 4.1: everything under the
 * hero's rule, as an ordered list of widgets on a 6-column grid. Height is the
 * widget's own. A cell whose widget drew nothing is hidden outright, so it
 * leaves neither a hole nor a gap: the default layout reads exactly as the
 * fixed Overview did.
 *
 * One grid draws both modes. Edit mode only adds — a frame, a toolbar, a drag —
 * around the same mounted widgets, so opening it never replays a ring or a bar.
 *
 * `header` and `footer` sit in the same grid at full width, so the rule above
 * and the fixed lines below share its row gap with the widgets.
 */
export function DashboardGrid({
  layout,
  header,
  footer,
  className,
  edit = null,
  gridRef,
}: {
  layout: DashboardLayout;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  edit?: GridEditing | null;
  gridRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const grid = gridRef ?? ownRef;
  const known = layout.widgets.filter((widget) => {
    if (widget.type in WIDGETS) return true;
    // A layout written by a newer release; this one skips what it does not know
    // rather than refusing the whole Overview.
    console.warn(`unknown dashboard widget type: ${String(widget.type)}`);
    return false;
  });
  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={grid}
        data-slot={edit === null ? undefined : "edit-grid"}
        data-closing={edit?.closing || undefined}
        className={cn("relative grid grid-flow-row-dense grid-cols-6 gap-4", className)}
      >
        {header}
        <div role={edit === null ? undefined : "list"} aria-label={edit?.label} className="contents">
          <AnimatePresence mode="popLayout" initial={false}>
            {known.map((widget, index) => (
              <GridCell key={widget.id} widget={widget} index={index} total={known.length} edit={edit} grid={grid} />
            ))}
          </AnimatePresence>
        </div>
        {footer}
      </div>
    </MotionConfig>
  );
}
