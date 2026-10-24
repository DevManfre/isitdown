import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Check, LayoutGrid, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { BorderBeam } from "@/components/ui/border-beam.tsx";
import { DotPattern } from "@/components/ui/dot-pattern.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { TypingAnimation } from "@/components/ui/typing-animation.tsx";
import { FleetSummary } from "@/components/FleetSummary.tsx";
import { HeroStats } from "@/components/HeroStats.tsx";
import { DashboardGrid, filterLabel, REORDER_SPRING, type GridEditing } from "@/components/DashboardGrid.tsx";
import { EmptyFleet } from "@/components/EmptyFleet.tsx";
import { ViewSkeleton } from "@/components/ViewSkeleton.tsx";
import { StatusBeacon } from "@/components/charts/StatusBeacon.tsx";
import { useDashboard, useDashboards, useHistory, useStatus } from "@/hooks/queries.ts";
import { useCurrentDashboardId } from "@/components/dashboards/DashboardMenu.tsx";
import { dashboardPath } from "@/components/dashboards/DashboardActions.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { ApiError } from "@/lib/api.ts";
import { CoverageProvider } from "@/lib/coverage.tsx";
import { statusLabelKey, worstTier } from "@/lib/chartConfig.ts";
import { formatList, formatRelative } from "@/lib/format.ts";
import { isOffLine, shownStatus, suspectedOf } from "@/lib/suspicion.ts";
import { suspectedHatchCss } from "@/lib/chartConfig.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { overviewShape } from "@/lib/overviewShape.ts";
import { cn } from "@/lib/utils.ts";
import { DEFAULT_LAYOUT, type WidgetConfig } from "../../dashboardLayout.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";
import { Reveal } from "@/widgets/edit/Reveal.tsx";
import CellChrome from "@/widgets/edit/CellChrome.tsx";
import EditMode from "@/widgets/edit/EditMode.tsx";
import { useLayoutEditor } from "@/widgets/edit/useLayoutEditor.ts";

/** How long the "Layout saved" line stays beside the actions. */
const NOTICE_MS = 4000;

/**
 * Design 3a's Overview: the gradient hero with the headline and two calls to
 * action, then the fleet.
 *
 * How the fleet is drawn is `overviewShape`'s decision, not this view's — it
 * changes at two counts because one layout cannot serve four providers and
 * fifty. Up to six, the 80px rings stay beside the copy; up to fourteen they
 * move to a full-width 56px band and the copy takes the whole width; beyond
 * that the rings go, the hero carries one aggregate figure, and the list groups
 * by severity with the operational fleet shut. The hero's height stops growing
 * with the fleet at the first threshold and never resumes.
 */
export function Overview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: status } = useStatus();
  const { data: summary } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  // Roadmap 4.2: the dashboard named in the address, or home.
  const dashboardId = useCurrentDashboardId();
  const { data: dashboards } = useDashboards();
  const {
    data: dashboard,
    isPlaceholderData: dashboardPending,
    isError: dashboardErrored,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useDashboard(dashboardId);
  /** A bookmark to a dashboard deleted since: not a failure to load, an answer. */
  const dashboardMissing = dashboardErrored && dashboardError instanceof ApiError && dashboardError.status === 404;
  const dashboardFailed = dashboardErrored && !dashboardMissing;
  /** One of several: its empty state names it rather than "the Overview". */
  const named = (dashboards?.length ?? 0) > 1;
  const [params, setParams] = useSearchParams();
  const editing = params.get("edit") === "1";
  const [notice, setNotice] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const customiseRef = useRef<HTMLButtonElement>(null);
  /** Edit mode just closed: its Save or Cancel is gone, so focus comes back to Customise. */
  const [returnFocus, setReturnFocus] = useState(false);
  // Only the server's answer may start a draft — never the placeholder a
  // pending query shows (⌘K and a bookmarked `?edit=1` can both get here first).
  const openedFromButton = useRef(false);
  const openEditor = () => {
    openedFromButton.current = true;
    setParams({ edit: "1" });
  };
  const editor = useLayoutEditor(
    dashboardPending ? undefined : dashboard,
    editing,
    gridRef,
    (message) => {
      setParams({});
      setReturnFocus(true);
      if (message !== undefined) setNotice(message);
    },
    openedFromButton,
  );
  useEffect(() => {
    if (!returnFocus || editing || customiseRef.current === null) return;
    customiseRef.current.focus();
    setReturnFocus(false);
  });
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // No `/status` yet: draw the page's shape, not its empty state. Read as
  // `data ?? []`, a slow first response told an operator with a full fleet
  // that none was configured — and "all 0 operational" in the hero above it.
  if (status === undefined) return <ViewSkeleton hero rows={6} />;

  // A disabled provider is one the poller has been told to skip
  // (poller.ts:164), so nothing about it is being measured any more. It is left
  // out of the fleet, the counts, the headline and the average rather than
  // drawn with a figure that stopped moving — `Providers` stays the view that
  // lists every configured provider, dimming the disabled ones.
  const configured = status?.providers ?? [];
  const providers = configured.filter((provider) => provider.enabled);
  const allDisabled = configured.length > 0 && providers.length === 0;
  const noneConfigured = configured.length === 0;
  const shape = overviewShape(providers.length);

  // The headline is chosen by plural rule, never assembled from fragments —
  // "one provider is off the line" and "3 providers are off the line" are
  // separate catalog entries, selected by i18next's count-based plural rule.
  // `unknown` is held apart from `down` on purpose: a provider nobody could read
  // — a bot challenge, a page we could not parse — has not been reported as off
  // the line by anyone, and saying it is would be a claim this dashboard cannot
  // back. It still earns its own sentence rather than being folded into "all
  // operational", because it is not that either.
  //
  // Roadmap 1.3: "off the line" is the provider's own word plus any reading the
  // operator declared to be the record (`observed`). A hatched suspicion is
  // neither, so it stays out of the headline and gets its own line below.
  const down = providers.filter(isOffLine);
  const unreadable = providers.filter((p) => p.overallStatus === "unknown" && !isOffLine(p));
  const suspected = suspectedOf(providers);
  const lastSeen = providers
    .map((p) => p.fetchedAt)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1);
  const withIncident = providers.find((p) => p.activeIncidents.length > 0);
  const average =
    providers.length === 0
      ? 0
      : Math.round(
          (providers.reduce((sum, p) => sum + p.uptime90, 0) /
            providers.length) *
            100,
        ) / 100;

  // One copy block for all three shapes: the words do not change with the
  // fleet's size, only where the fleet is drawn does.
  const heroCopy = (
    <div className="hero-copy flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="anim-rise text-xs uppercase tracking-widest text-primary">
          {t("overview.kicker")}
        </span>
        <AnimatePresence>
          {editing && (
            <motion.span
              key="hero-fixed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.22 } }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              className="rounded-full border border-dashed border-border px-2 py-0 font-mono text-xs leading-[14px] text-muted-foreground"
            >
              {t("dashboard.hero-fixed")}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {/* The beacon shares the headline's line rather than sitting above
          it: the two say the same thing, and splitting them reads as two
          separate claims. */}
      <div
        className="anim-rise anim-rise-hero flex items-center gap-3"
        style={{ animationDelay: "50ms" }}
      >
        <StatusBeacon
          tier={worstTier(
            providers.map((p) => (shownStatus(p).hatched ? p.overallStatus : shownStatus(p).status)),
          )}
        />
        {/* 28px on a phone: at `text-4xl` the four-word headline took six
            lines of a 390px screen and pushed the fleet under the fold. */}
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-balance md:text-3xl lg:text-4xl lg:leading-[1.1]">
          {allDisabled ? (
            t("overview.title.all-disabled")
          ) : noneConfigured ? (
            t("overview.title.empty")
          ) : down.length === 0 ? (
            unreadable.length === 0 ? (
              t("overview.title.all-operational")
            ) : (
              t("overview.title.unreadable", { count: unreadable.length })
            )
          ) : down.length === 1 ? (
            // The one-provider headline is a plain sentence — the plural
            // entry is the only one that carries a figure — so it types
            // itself in instead of arriving whole. The count-bearing
            // entry keeps the ticker: a number counting up inside a line
            // that is still being typed reads as two flourishes fighting.
            <TypingAnimation text={t("overview.title.down", { count: 1 })} />
          ) : (
            <Trans
              i18nKey="overview.title.down"
              count={down.length}
              values={{ count: down.length }}
              components={[
                <NumberTicker locale={i18n.language} value={down.length} />,
              ]}
            />
          )}
        </h2>
      </div>
      {/* Capped in `ch` rather than by its grid column: in the band shape the
          copy owns the full width, and a 900px-wide line is unreadable. */}
      {/* With nothing enabled there is no cycle to report on, so this claim is
          dropped rather than rendered as "All 0 providers responded" — the
          sentence that explains the state is the one in the fleet region, said
          once. The paragraph goes with it, so the gap does not stay behind. */}
      {!allDisabled && !noneConfigured && (
        <p
          className="anim-rise anim-rise-hero max-w-[68ch] text-muted-foreground"
          style={{ animationDelay: "100ms" }}
        >
          {down.length === 0 && unreadable.length > 0 ? (
            t("overview.body.unreadable", {
              count: unreadable.length,
              providers: formatList(i18n.language, unreadable.map((p) => p.name)),
            })
          ) : down.length === 0 ? (
            <Trans
              i18nKey="overview.body.all-operational"
              values={{
                count: providers.length,
                since:
                  lastSeen === undefined
                    ? t("meta.never-polled")
                    : formatRelative(i18n.language, lastSeen),
              }}
              components={[
                <NumberTicker
                  locale={i18n.language}
                  value={providers.length}
                />,
              ]}
            />
          ) : (
            t("overview.body.down", {
              count: down.length,
              providers: formatList(i18n.language, down.map((p) => p.name)),
            })
          )}
        </p>
      )}
      {/* Roadmap 1.3. One line per suspected provider, under the claim the
          headline makes rather than inside it: the page has not said this, so
          it must not be counted as if it had. */}
      {!allDisabled && suspected.length > 0 && (
        <ul
          data-testid="overview-suspected"
          className="anim-rise anim-rise-hero flex max-w-[68ch] flex-col gap-1 text-sm"
          style={{ animationDelay: "120ms" }}
        >
          {suspected.map((p) => {
            const suspicion = shownStatus(p).suspicion!;
            return (
              <li key={p.id} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="size-3 flex-none rounded-full"
                  style={{ background: suspectedHatchCss(suspicion.status) }}
                />
                <span>
                  <Trans
                    i18nKey="suspected.overview"
                    values={{
                      provider: p.name,
                      status: t(statusLabelKey(suspicion.status)).toLowerCase(),
                      since: formatRelative(i18n.language, suspicion.since),
                    }}
                    components={[
                      <Link
                        key="provider"
                        className="text-primary hover:underline"
                        to={ROUTE_PATHS.providerDetail.replace(":providerId", p.id)}
                      />,
                    ]}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div
        className="anim-rise anim-rise-hero flex flex-wrap items-center gap-2"
        style={{ animationDelay: "150ms" }}
      >
        {withIncident !== undefined && (
          <Button
            type="button"
            onClick={() =>
              navigate(
                `/incidents/${withIncident.id}/${withIncident.activeIncidents[0]?.id ?? ""}`,
              )
            }
          >
            {t("action.incident-details")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate(ROUTE_PATHS.history)}
        >
          {t("action.history-90d")}
        </Button>
        {/* The layout could not be read: the default stands in, and the
            page says so rather than presenting it as the operator's own. */}
        {dashboardFailed && (
          <span role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">
            {t("dashboard.load-failed", {
              error: dashboardError instanceof Error ? dashboardError.message : String(dashboardError),
            })}
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void refetchDashboard()}>
              {t("action.retry")}
            </Button>
          </span>
        )}
        {!editing && !noneConfigured && !dashboardPending && !dashboardErrored && (
          <Button
            ref={customiseRef}
            type="button"
            variant="ghost"
            onClick={openEditor}
          >
            <LayoutGrid aria-hidden="true" />
            {t("dashboard.customise")}
          </Button>
        )}
        <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {notice !== null && (
            <span className="anim-fade flex items-center gap-1.5">
              <Check aria-hidden="true" className="size-4 text-[var(--status-operational)]" />
              {t(notice)}
            </span>
          )}
        </span>
      </div>
    </div>
  );

  const layout = dashboardMissing
    ? { version: 1 as const, widgets: [] }
    : (editor?.draft.layout ?? dashboard?.layout ?? DEFAULT_LAYOUT);
  /** What a widget's toolbar says it is pointed at: its fleet filter, or its one provider. */
  const pointedAt = (widget: WidgetConfig): string | null => {
    if ("filter" in widget.props) return filterLabel(widget.props.filter, status, t);
    if (!("provider" in widget.props)) return null;
    const chosen = widget.props.provider;
    if (chosen === null) return t("dashboard.provider.worst");
    return status?.providers.find((p) => p.id === chosen)?.name ?? t("dashboard.filter.removed", { name: chosen });
  };
  const gridEdit: GridEditing | null =
    editor === null
      ? null
      : {
          revision: editor.draft.revision,
          closing: editor.closing,
          entering: editor.entering,
          arrived: editor.arrived,
          label: t("dashboard.edit.list-label"),
          onDragTo: (id, index) => editor.dispatch({ type: "moveTo", id, index }),
          renderChrome: ({ widget, index, total, startDrag }) => (
            <CellChrome
              widget={widget}
              index={index}
              total={total}
              closing={editor.closing}
              filterText={pointedAt(widget)}
              filterOpen={editor.filterOpen === widget.id}
              dispatch={editor.dispatch}
              onToggleFilter={() => editor.toggleFilter(widget.id)}
              startDrag={startDrag}
            />
          ),
        };
  /* The rule sweeps in under the hero, before the rows arrive. */
  const rule = (
    <div className="fade-rule anim-sweep col-span-6 h-px bg-border" style={{ animationDelay: "170ms" }} />
  );

  return (
    // Roadmap 10.1: the bar rows below draw the poller's own gaps.
    <CoverageProvider coverage={summary?.dailyCoverage}>
      {/* The standard view padding is dropped here (there is no `.view` class
          left to remove — the whole layer moved to Tailwind), so the hero's own
          light can bleed to the true edges of #view instead of stopping at the
          console's usual 32px gutter, then restore the same inset for its own
          content.

          The band is lit rather than washed: the accent bloom the palette
          always carried, a dot grid under it for texture, a beam along the top
          edge, and — only while something is actually down — a second bloom in
          the severity colour and a beam travelling the border. That last pair
          is the whole point of the redesign's hero: the page says "something is
          wrong" before a single word of it is read.

          `minmax(0,1fr) auto` where this used to say `grid-cols-2`: the copy is
          four lines and never grew, so a fixed half handed the right-hand
          column the other half whatever it held.

          The fleet's rings no longer live in here. They were what made the hero
          grow with the fleet, and `HeroStats` is the fixed-height column that
          replaces them — the rings moved below the rule, where a row of tiles
          can wrap without pushing the headline around. */}
      <div
        className="view-hero lit-band relative -mx-4 -mt-6 overflow-hidden border-b border-border px-4 pt-6 pb-7 md:-mx-8 md:px-8"
        style={{
          backgroundImage:
            down.length === 0
              ? "var(--gradient-hero)"
              : "var(--gradient-hero-live), var(--gradient-hero)",
        }}
      >
        <DotPattern className="text-foreground/8" />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary to-transparent"
        />
        {down.length > 0 && (
          <BorderBeam
            size={160}
            duration={9}
            colorFrom="var(--status-major-outage)"
            colorTo="var(--status-degraded)"
          />
        )}
        <div
          className={cn(
            "relative grid gap-8",
            shape === "band"
              ? "grid-cols-1"
              : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]",
          )}
        >
          {heroCopy}
          {shape === "dense" ? (
            <FleetSummary
              average={average}
              operational={providers.length - down.length}
              alarm={down.length}
            />
          ) : (
            providers.length > 0 && (
              <HeroStats providers={providers} average={average} />
            )
          )}
        </div>
      </div>

      {/* Roadmap 4.1: under the rule, the Overview is the operator's own
          layout — the default one being the fixed sequence this view always
          drew. The rule and the first-run line share the grid's row gap, so
          the default reads exactly as the fixed column did. */}
      {/* One grid for both modes (roadmap 4.1): edit mode adds chrome around
          the same mounted widgets, so opening it never replays an entry. */}
      {/* Roadmap 4.2. Below 768px the rail is gone, so the named dashboards
          are picked here instead — only once there is more than one. */}
      {dashboards !== undefined && dashboards.length > 1 && dashboardId !== undefined && (
        <div className="mb-4 flex flex-col gap-1.5 md:hidden">
          <span id="dashboard-switcher" className="text-xs text-muted-foreground">
            {t("dashboards.switcher")}
          </span>
          <Select value={dashboardId} onValueChange={(id) => void navigate(dashboardPath(id))}>
            <SelectTrigger aria-labelledby="dashboard-switcher" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dashboards.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.home ? t("dashboards.home-suffix", { name: d.name }) : d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DashboardGrid
        className="overview-rows"
        gridRef={gridRef}
        layout={layout}
        edit={gridEdit}
        header={rule}
        footer={
          editor !== null ? (
            <>
              <p id="dashboard-move-hint" className="sr-only">
                {t("dashboard.move.hint")}
              </p>
              <motion.div
                layout="position"
                layoutDependency={editor.draft.revision}
                transition={{ layout: REORDER_SPRING }}
                className="col-span-6"
              >
                <Reveal open={!editor.closing}>
                  <Button
                    type="button"
                    variant="outline"
                    data-add-widget
                    className="h-14 w-full rounded-xl border-dashed border-primary text-primary"
                    onClick={() => editor.setCatalogOpen(true)}
                  >
                    <Plus aria-hidden="true" />
                    {t("dashboard.add")}
                  </Button>
                </Reveal>
              </motion.div>
            </>
          ) : dashboardMissing ? (
            <Card className="col-span-6 border-dashed">
              <CardContent className="flex flex-col items-start gap-3">
                <h3 className="text-base font-semibold">{t("dashboards.missing.title")}</h3>
                <p className="max-w-[60ch] text-sm text-muted-foreground">
                  {t("dashboards.missing.body", { id: dashboardId ?? "" })}
                </p>
                <Button type="button" size="sm" onClick={() => void navigate(ROUTE_PATHS.overview)}>
                  {t("dashboards.missing.open-home")}
                </Button>
              </CardContent>
            </Card>
          ) : noneConfigured ? (
            <div className="col-span-6">
              <EmptyFleet />
            </div>
          ) : providers.length === 0 ? (
            <p className="col-span-6 text-muted-foreground">{t("overview.all-disabled")}</p>
          ) : layout.widgets.length === 0 ? (
            <Card className="col-span-6 border-dashed">
              <CardContent className="flex flex-col items-start gap-3">
                {/* A named dashboard (4.2) is usually empty because it was made
                    that way, not because everything was taken off it. */}
                <h3 className="text-base font-semibold">
                  {named ? t("dashboards.empty.title", { name: dashboard?.name ?? "" }) : t("dashboard.empty.title")}
                </h3>
                <p className="max-w-[60ch] text-sm text-muted-foreground">
                  {t(named ? "dashboards.empty.body" : "dashboard.empty.body")}
                </p>
                <Button type="button" size="sm" onClick={openEditor}>
                  <LayoutGrid aria-hidden="true" />
                  {t("dashboard.customise")}
                </Button>
              </CardContent>
            </Card>
          ) : null
        }
      />
      {editor !== null && dashboard !== undefined && <EditMode editor={editor} dashboard={dashboard} />}
    </CoverageProvider>
  );
}
