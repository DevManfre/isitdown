import { useNavigate } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { BorderBeam } from "@/components/ui/border-beam.tsx";
import { DotPattern } from "@/components/ui/dot-pattern.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { TypingAnimation } from "@/components/ui/typing-animation.tsx";
import { FleetGroups } from "@/components/FleetGroups.tsx";
import { FleetRings } from "@/components/FleetRings.tsx";
import { FLEET_ROW_STAGGER, FleetRows } from "@/components/FleetRows.tsx";
import { FleetSummary } from "@/components/FleetSummary.tsx";
import { HeroStats } from "@/components/HeroStats.tsx";
import { StackBand } from "@/components/StackBand.tsx";
import { GeoCard } from "@/components/GeoCard.tsx";
import { StatusBeacon } from "@/components/charts/StatusBeacon.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { CoverageProvider } from "@/lib/coverage.tsx";
import { worstTier } from "@/lib/chartConfig.ts";
import { formatRelative } from "@/lib/format.ts";
import { summaryProviders } from "@/lib/history.ts";
import { overviewShape } from "@/lib/overviewShape.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

const WINDOW_DAYS = 90;

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
  const { data: summary } = useHistory({ days: WINDOW_DAYS });

  // A disabled provider is one the poller has been told to skip
  // (poller.ts:164), so nothing about it is being measured any more. It is left
  // out of the fleet, the counts, the headline and the average rather than
  // drawn with a figure that stopped moving — `Providers` stays the view that
  // lists every configured provider, dimming the disabled ones.
  const configured = status?.providers ?? [];
  const providers = configured.filter((provider) => provider.enabled);
  const allDisabled = configured.length > 0 && providers.length === 0;
  const buckets = new Map(
    summaryProviders(summary).map((p) => [p.providerId, p.buckets]),
  );
  const shape = overviewShape(providers.length);

  // The headline is chosen by plural rule, never assembled from fragments —
  // "one provider is off the line" and "3 providers are off the line" are
  // separate catalog entries, selected by i18next's count-based plural rule.
  // `unknown` is held apart from `down` on purpose: a provider nobody could read
  // — a bot challenge, a page we could not parse — has not been reported as off
  // the line by anyone, and saying it is would be a claim this dashboard cannot
  // back. It still earns its own sentence rather than being folded into "all
  // operational", because it is not that either.
  const down = providers.filter(
    (p) => p.overallStatus !== "operational" && p.overallStatus !== "unknown",
  );
  const unreadable = providers.filter((p) => p.overallStatus === "unknown");
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
      <span className="anim-rise text-xs uppercase tracking-widest text-primary">
        {t("overview.kicker")}
      </span>
      {/* The beacon shares the headline's line rather than sitting above
          it: the two say the same thing, and splitting them reads as two
          separate claims. */}
      <div
        className="anim-rise anim-rise-hero flex items-center gap-3"
        style={{ animationDelay: "50ms" }}
      >
        <StatusBeacon tier={worstTier(providers.map((p) => p.overallStatus))} />
        {/* 28px on a phone: at `text-4xl` the four-word headline took six
            lines of a 390px screen and pushed the fleet under the fold. */}
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-balance md:text-3xl lg:text-4xl lg:leading-[1.1]">
          {allDisabled ? (
            t("overview.title.all-disabled")
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
      {!allDisabled && (
        <p
          className="anim-rise anim-rise-hero max-w-[68ch] text-muted-foreground"
          style={{ animationDelay: "100ms" }}
        >
          {down.length === 0 && unreadable.length > 0 ? (
            t("overview.body.unreadable", {
              providers: unreadable.map((p) => p.name).join(", "),
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
              providers: down.map((p) => p.name).join(", "),
            })
          )}
        </p>
      )}
      <div
        className="anim-rise anim-rise-hero flex gap-2"
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
      </div>
    </div>
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

      <div className="overview-rows flex flex-col gap-4">
        {/* The rule sweeps in under the hero, before the rows arrive. */}
        <div
          className="fade-rule anim-sweep h-px bg-border"
          style={{ animationDelay: "170ms" }}
        />

        {/* The fleet as tiles, in the two shapes that still draw them. Out of
            the hero (see above) and into the page's own column, where a wrap is
            free. */}
        {shape !== "dense" && providers.length > 0 && (
          <FleetRings providers={providers} shape={shape} />
        )}

        {/* A summary belongs above the detail. The card renders nothing at all
            when `mapView` is `off`, which is the default, so the Overview's
            existing shape is unchanged for anyone who has not asked for it. */}
        <GeoCard />

        {/* Roadmap 2.6: the groups, above the flat fleet they summarise. */}
        <StackBand groups={status?.groups ?? []} providers={providers} />

        {providers.length === 0 ? (
          <p className="text-muted-foreground">
            {t(allDisabled ? "overview.all-disabled" : "providers.empty")}
          </p>
        ) : (
          <>
            {shape === "dense" ? (
              <FleetGroups providers={providers} buckets={buckets} />
            ) : (
              <FleetRows providers={providers} buckets={buckets} />
            )}
            <div
              className="anim-fade text-sm text-muted-foreground"
              style={{
                animationDelay: stagger(providers.length, FLEET_ROW_STAGGER),
              }}
            >
              <Trans
                i18nKey="overview.uptime-window"
                values={{ uptime: average }}
                components={[
                  <NumberTicker
                    locale={i18n.language}
                    value={average}
                    decimalPlaces={2}
                    suffix="%"
                  />,
                ]}
              />
            </div>
          </>
        )}
      </div>
    </CoverageProvider>
  );
}
