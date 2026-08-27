import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createColumnHelper,
  createSortedRowModel,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { SortDirection } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { ComponentRows } from "@/components/ComponentRows.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { severity, statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { hostOf } from "@/lib/format.ts";
import { summaryProviders } from "@/lib/history.ts";
import { isReorder, rowShifts } from "@/lib/rowShift.ts";
import type { ComponentStatus, HistoryBucket, OverallStatus, ProviderStatus } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

const WINDOW_DAYS = 90;

/** How long a dropped row stays mounted; in step with `.anim-sink` in motion.css. */
const EXIT_MS = 220;

/** How long a collapsing panel stays mounted; in step with `.anim-fold` there. */
const FOLD_MS = 220;

type Filter = "all" | "issues";

/** No provider yet: a fresh fallback array each render would invalidate the row model. */
const NO_PROVIDERS: ProviderStatus[] = [];

/**
 * One table row, flattened.
 *
 * A sortable column has to sort on the same value its cell shows, so uptime
 * and the incident count are resolved out of the history summary here rather
 * than inside the cell renderer.
 */
interface ProviderRow {
  id: string;
  name: string;
  host: string;
  adapter: string;
  status: OverallStatus;
  /**
   * chartConfig's severity weight, so the status column sorts by how bad a
   * status is rather than alphabetically by its label. `unknown` sits below
   * `operational` there on purpose: never measured is not a fault.
   */
  severity: number;
  uptime: number;
  incidents: number;
  buckets: HistoryBucket[];
  enabled: boolean;
  /**
   * The components this provider actually monitors, and the live status of
   * each. A provider with an empty selection watches only the overall status,
   * so it has nothing to expand — which is what `getRowCanExpand` reads.
   */
  monitored: { id: string; name: string }[];
  components: ComponentStatus[];
}

/**
 * The data table's feature set — sorting, and nothing else.
 *
 * TanStack Table v9 installs a feature's state and APIs only where the
 * feature is registered, so there is no filtered row model here (the
 * all/issues toggle stays plain component state, as it was) and no
 * pagination: the fleet is a handful of rows.
 */
const features = tableFeatures({
  rowExpandingFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});

const helper = createColumnHelper<typeof features, ProviderRow>();

/** Only what the header control touches, so it carries none of the table's generics. */
interface SortableColumn {
  getIsSorted: () => false | SortDirection;
  getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
}

/**
 * A column header as the table's sort control: shadcn's data-table pattern of
 * a ghost button inside the `<th>`, the arrow standing in for the state.
 */
function SortHead({ column, label }: { column: SortableColumn; label: string }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <Button variant="ghost" size="sm" className="-mx-2" onClick={column.getToggleSortingHandler()}>
      {label}
      <Icon className={cn("size-3", sorted === false && "opacity-40")} />
    </Button>
  );
}

/** The id a chevron's `aria-controls` points at: that row's own detail panel. */
const panelId = (rowId: string) => `components-${rowId}`;

/** What `aria-sort` on the header cell says, so the state reaches a screen reader too. */
const ariaSort = (sorted: false | SortDirection): "ascending" | "descending" | "none" =>
  sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none";

const hasIssue = (provider: ProviderStatus) => provider.overallStatus !== "operational";

/** The ids the filter keeps: the whole fleet, or only what has an open issue. */
const shownBy = (providers: readonly ProviderStatus[], filter: Filter): string[] =>
  (filter === "issues" ? providers.filter(hasIssue) : providers).map((provider) => provider.id);

/**
 * The ids that were on the page a render ago and are not any more, held for
 * one exit-animation beat.
 *
 * Nothing unmounted can animate, so flipping to "issues" used to blink the
 * operational rows out of existence while the arriving ones rose in, and
 * collapsing a row used to cut its panel away in a single frame. Keeping what
 * is going mounted for the length of its exit buys the leave the choreography
 * the entry already had — `.anim-sink` for a dropped row, `.anim-fold` for a
 * closing panel.
 */
function useOutgoing(ids: readonly string[], hold: number): ReadonlySet<string> {
  // The ids themselves are the identity of a render: `ids` is a fresh array
  // every time, and only a change of membership means anything here.
  const key = ids.join(",");
  const [tracked, setTracked] = useState<{ key: string; outgoing: ReadonlySet<string> }>(() => ({
    key,
    outgoing: new Set(),
  }));

  // Worked out during the render that first sees the change, not in an effect
  // afterwards: React discards this pass and re-runs it with `outgoing`
  // already filled, so what is leaving stays in the DOM it is in. An effect
  // would commit one paint without it first, and it would be torn down and
  // rebuilt just to fade — a flash, which is the thing being fixed.
  if (tracked.key !== key) {
    const present = new Set(ids);
    const gone = tracked.key === "" ? [] : tracked.key.split(",").filter((id) => !present.has(id));
    setTracked({ key, outgoing: new Set(gone) });
  }

  useEffect(() => {
    if (tracked.outgoing.size === 0) return;
    // Reduced motion plays no exit animation, so there is nothing to wait for.
    const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : hold;
    const timer = setTimeout(() => setTracked((current) => ({ key: current.key, outgoing: new Set() })), wait);
    return () => clearTimeout(timer);
  }, [tracked, hold]);

  return tracked.outgoing;
}

/**
 * Plays the closing of the gap a dropped row leaves behind, instead of letting
 * the rows below it jump a row's height the instant it unmounts.
 *
 * `.anim-sink` only dissolves the row that is going; the collision underneath
 * it was still a cut. So every commit measures the body, and any row that
 * changed place is put back where it was and released a frame later — the rows
 * close ranks along the same curve the rest of the view moves on. It smooths
 * the opposite case for free: rows pushed down by an arriving one glide down
 * while that one rises.
 *
 * The offset rides `translate`, not `transform`: `rise` is an
 * `animation-fill-mode: both` animation that keeps its final `transform: none`
 * applied to the row for good, and an animation outranks an inline style.
 *
 * Only a reorder is played (`isReorder`). A row also moves when the accordion
 * panel above it unfolds, and that travel belongs to `.anim-unfold`; measuring
 * it here produced two motions on one row at open, and — because the panel
 * keeps growing with no render to re-measure on — a stale baseline that the
 * next poll replayed as an 89px jump nothing had asked for.
 */
function useRowShift() {
  const body = useRef<HTMLTableSectionElement>(null);
  const tops = useRef<ReadonlyMap<string, number>>(new Map());

  useLayoutEffect(() => {
    if (body.current === null) return;
    const rows = new Map(
      [...body.current.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]")].map((row) => [
        row.dataset.rowId ?? "",
        row,
      ]),
    );
    const current = new Map([...rows].map(([id, row]) => [id, row.offsetTop]));
    const previous = tops.current;
    // Re-baselined either way, and before the gate: an accordion panel goes on
    // growing after the commit that mounted it, so the measurement this leaves
    // behind is the only one the next render can trust.
    tops.current = current;
    if (!isReorder([...previous.keys()], [...current.keys()])) return;
    const shifts = rowShifts(previous, current);
    if (shifts.size === 0) return;

    for (const [id, offset] of shifts) {
      const row = rows.get(id);
      if (row === undefined) continue;
      row.style.transition = "none";
      row.style.translate = `0 ${offset}px`;
      // Reading a layout property commits that start position; without the
      // flush the browser only ever sees the final one and nothing animates.
      void row.offsetHeight;
      row.style.transition = "";
    }
    const frame = requestAnimationFrame(() => {
      for (const id of shifts.keys()) {
        const row = rows.get(id);
        if (row !== undefined) row.style.translate = "";
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  return body;
}

/**
 * Design 3a's Providers table: one row per configured provider with its
 * status, an inline uptime strip, and its uptime and incident counts.
 *
 * Read-only by design — adding, editing and removing a provider all live in
 * Settings (Task 12), so a glance at the fleet can never turn into an
 * accidental edit. Straight port of src/ui/public/js/views/providers.js,
 * minus the edit/remove buttons and add-service dialog that move there.
 *
 * The rows are a shadcn data table (TanStack Table v9) rather than a plain
 * `<Table>`: every column header sorts, which is what a fleet view is for —
 * worst status, worst uptime, most incidents, each one click away. The
 * reorder animates itself, because useRowShift already plays any change of
 * row position as motion.
 */
export function Providers() {
  const { t, i18n } = useTranslation();
  const { data: status } = useStatus();
  const { data: summary } = useHistory(WINDOW_DAYS);
  const [filter, setFilter] = useState<Filter>("all");

  const providers = status?.providers ?? NO_PROVIDERS;

  // providers.js:64-67 — showIssuesOnly filters client-side to the providers
  // with an open issue; "all" is otherwise the fleet in its configured order.
  const shownIds = shownBy(providers, filter);
  // Sits above the empty-state return below: a hook cannot go behind one.
  const leaving = useOutgoing(shownIds, EXIT_MS);
  const body = useRowShift();

  // The row model is rebuilt from this array's identity, so it is memoised on
  // the three things that actually change it. `leaving` is state: a new Set
  // only when membership changed.
  const data = useMemo<ProviderRow[]>(() => {
    const byId = new Map(summaryProviders(summary).map((provider) => [provider.providerId, provider]));
    const shown = new Set(shownBy(providers, filter));
    return providers
      .filter((provider) => shown.has(provider.id) || leaving.has(provider.id))
      .map((provider) => {
        const history = byId.get(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          host: hostOf(provider.baseUrl),
          adapter: provider.adapter,
          status: provider.overallStatus,
          severity: severity(provider.overallStatus),
          uptime: history?.uptime90 ?? provider.uptime90,
          incidents: history?.incidentCount ?? 0,
          buckets: history?.buckets ?? [],
          enabled: provider.enabled,
          monitored: provider.componentSelection,
          components: provider.components,
        };
      });
  }, [providers, summary, filter, leaving]);

  // Rebuilt when the catalog language changes, since every header label and
  // the status labels are resolved through `t()` in here.
  const columns = useMemo(
    () =>
      helper.columns([
        // The accordion's own column: a chevron on the rows that have
        // components to show, an empty cell on the rest. No header label —
        // the control belongs to the row, and a column of chevrons is not a
        // dimension anyone sorts by.
        helper.display({
          id: "expand",
          header: () => null,
          cell: ({ row }) =>
            row.getCanExpand() ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={row.getIsExpanded()}
                aria-controls={panelId(row.id)}
                aria-label={t("providers.components-toggle")}
                onClick={row.getToggleExpandedHandler()}
              >
                <ChevronRight className={cn("size-4 transition-transform", row.getIsExpanded() && "rotate-90")} />
              </Button>
            ) : null,
        }),
        helper.accessor("name", {
          header: ({ column }) => <SortHead column={column} label={t("column.provider")} />,
          sortFn: "text",
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <StatusDot status={row.original.status} glow={8} />
              <span className="flex flex-col">
                <span>{row.original.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{row.original.host}</span>
              </span>
            </span>
          ),
        }),
        helper.accessor("adapter", {
          header: ({ column }) => <SortHead column={column} label={t("column.adapter")} />,
          sortFn: "text",
          cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
        }),
        helper.accessor("severity", {
          header: ({ column }) => <SortHead column={column} label={t("column.status")} />,
          sortFn: "basic",
          // Worst first on the first click: that is the row being looked for.
          sortDescFirst: true,
          cell: ({ row }) => (
            <span style={{ color: statusColor(row.original.status) }}>
              {t(statusLabelKey(row.original.status))}
            </span>
          ),
        }),
        helper.accessor("uptime", {
          header: ({ column }) => <SortHead column={column} label={t("column.uptime")} />,
          sortFn: "basic",
          // Lowest uptime first, for the same reason.
          sortDescFirst: false,
          cell: ({ row }) => (
            <span className="flex min-w-40 items-center gap-3">
              <UptimeStrip buckets={row.original.buckets} />
              <span className="font-mono text-xs">
                <NumberTicker locale={i18n.language} value={row.original.uptime} decimalPlaces={2} suffix="%" />
              </span>
            </span>
          ),
        }),
        helper.accessor("incidents", {
          header: ({ column }) => <SortHead column={column} label={t("column.incidents")} />,
          sortFn: "basic",
          // Busiest provider first.
          sortDescFirst: true,
          cell: ({ getValue }) => (
            <span className="font-mono text-xs">
              <NumberTicker locale={i18n.language} value={getValue()} />
            </span>
          ),
        }),
      ]),
    [t, i18n.language],
  );

  const table = useTable({
    features,
    columns,
    data,
    // Provider ids are what the exit animation and the FLIP measure rows by.
    getRowId: (row) => row.id,
    // A third click on a header drops the sort instead of cycling back to
    // ascending, so the configured order stays one click away.
    enableSortingRemoval: true,
    // One column at a time: five columns do not need a shift-click contract.
    enableMultiSort: false,
    // The panel a chevron opens is a detail row this view renders itself, not
    // a tree of sub-rows for the row model to flatten in — so expansion is
    // manual, and only a row with a component selection can open at all.
    manualExpanding: true,
    getRowCanExpand: (row) => row.original.monitored.length > 0,
  });

  const rows = table.getRowModel().rows;
  // A panel the operator has just closed is held open for one fold, the same
  // way a filtered-out row is held for one sink.
  const folding = useOutgoing(
    rows.filter((row) => row.getIsExpanded()).map((row) => row.id),
    FOLD_MS,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="anim-fade text-sm text-muted-foreground">{t("providers.intro")}</p>
        {/* providers.js:73-97 (headerRow) — a seg-pills toggle beside the
            intro line. `type="multiple"` (not "single") so Radix leaves the
            plain `aria-pressed` attribute alone instead of swapping in
            `role="radio"`/`aria-checked` — matching the codebase's own
            convention (Header.tsx's language switcher) and motion.css's
            `[data-slot="toggle-group-item"]` transition hook either way.
            Single-selection is enforced by hand below. */}
        <ToggleGroup
          type="multiple"
          value={[filter]}
          onValueChange={(next) => {
            // Clicking the already-active option yields an empty array
            // (providers.js:86's no-op guard); a real change yields the
            // newly-picked option alongside the outgoing one.
            const picked = next.find((v) => v !== filter);
            if (picked === "all" || picked === "issues") setFilter(picked);
          }}
        >
          <ToggleGroupItem value="all">{t("filter.all")}</ToggleGroupItem>
          <ToggleGroupItem value="issues">{t("filter.issues")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {data.length === 0 ? (
        <p className="text-muted-foreground">{t("providers.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} aria-sort={ariaSort(header.column.getIsSorted())}>
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody ref={body}>
            {rows.map((row, index) => {
              const isLeaving = leaving.has(row.id);
              return (
                <Fragment key={row.id}>
                  <TableRow
                    // What useRowShift measures each row by; a key is React's
                    // own bookkeeping and never reaches the DOM.
                    data-row-id={row.id}
                    // A disabled provider is still listed, only dimmed: its
                    // history is real either way.
                    className={cn(
                      isLeaving ? "anim-sink" : "anim-rise anim-rise-table-row",
                      !row.original.enabled && "opacity-55",
                    )}
                    // A row on its way out goes at once; only arrivals stagger.
                    style={{ animationDelay: isLeaving ? "0ms" : `${index * 60}ms` }}
                  >
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                  {/* The panel the chevron opens. Deliberately carries no
                      `data-row-id`: useRowShift measures provider rows only, so
                      the rows below still close ranks as this one unfolds. */}
                  {(row.getIsExpanded() || folding.has(row.id)) && (
                    // No hover on the panel: TableRow's own `hover:bg-muted/50`
                    // is for a row an operator can act on, and this is content.
                    <TableRow id={panelId(row.id)} className="hover:bg-transparent">
                      <TableCell colSpan={row.getAllCells().length} className="p-0 whitespace-normal">
                        <div className={row.getIsExpanded() ? "anim-unfold" : "anim-fold"}>
                          {/* Bare on purpose: this is the clipping box, and the
                              padding belongs inside it. A `fr` track can never
                              flex below its content's base size, so padding
                              here would floor the fold at 16px and leave only
                              the fade to play. */}
                          <div>
                            <div className="px-2 pb-4">
                              <ComponentRows
                                providerId={row.original.id}
                                days={WINDOW_DAYS}
                                current={row.original.components}
                              />
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
