import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Maximize2, X } from "lucide-react";
import { useStatus } from "@/hooks/queries.ts";
import { statusColor, statusFill, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatPercent, formatTime } from "@/lib/format.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The office screen — roadmap 5.8.
 *
 * Everything else in this dashboard is built for somebody sitting in front of
 * it. This is built for a television across a room: no rail, no header, no
 * controls to speak of, type large enough to read standing up, and the fleet
 * rotating through itself so a wall of fifteen providers does not become
 * fifteen unreadable tiles.
 *
 * It is a sibling of the app shell rather than a view inside it, which is the
 * whole point: a view cannot remove the chrome around it, and a "hide the rail"
 * flag threaded through `App` would be a second layout mode for every screen
 * instead of one screen with no layout.
 *
 * It paints only what `/status` already carries — status, uptime, incidents —
 * so the screen that is left on all day costs one query, the same one every
 * other view is already sharing.
 */

/** How many tiles a page holds. Four across at a glance, two rows deep. */
const PER_PAGE = 8;

/** How long a page stays up. Long enough to read, short enough to come back round. */
const ROTATE_MS = 15_000;

/**
 * Whether this screen wants motion. A wallboard that rotates is exactly the
 * kind of unrequested movement `prefers-reduced-motion` exists for — and it is
 * also what makes the visual baseline of this view a fixed frame rather than
 * whichever page the capture happened to land on.
 */
const wantsStillness = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A browser (or a test environment) with no matchMedia is not a browser
    // asking for stillness.
    return false;
  }
};

export function Wallboard() {
  const { t, i18n } = useTranslation();
  const { data: status } = useStatus();
  const [page, setPage] = useState(0);

  const providers = (status?.providers ?? []).filter((provider) => provider.enabled);
  const pages = Math.max(1, Math.ceil(providers.length / PER_PAGE));

  // Rotation is an effect of the page count, so a fleet that shrinks below one
  // page stops rotating rather than cycling through a single page forever.
  useEffect(() => {
    if (pages <= 1 || wantsStillness()) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % pages), ROTATE_MS);
    return () => clearInterval(timer);
  }, [pages]);

  // A page that no longer exists — the fleet shrank while this was on screen —
  // must not leave the board blank until the next tick.
  useEffect(() => {
    if (page >= pages) setPage(0);
  }, [page, pages]);

  const shown = providers.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const alarm = providers.filter(
    (provider) => provider.overallStatus !== "operational" && provider.overallStatus !== "unknown",
  );

  const goFullscreen = (): void => {
    // Best effort: a browser that refuses (no gesture, an iframe, a policy) is
    // not an error worth a message on a screen nobody is standing at.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <main
      aria-label={t("wallboard.title")}
      className="flex min-h-screen w-full flex-col gap-6 p-8"
      // The same two markers `ViewFrame` stamps on every other screen. This
      // view is outside the shell, so it has no frame to stamp them for it —
      // and without them the visual harness, which waits for `#view
      // [data-animate]`, would sit out its whole timeout on every capture and
      // then agree whatever it found. `data-animate` is set once the status
      // query has answered, which is this screen's own definition of ready.
      id="view"
      data-animate={status === undefined ? undefined : "wallboard"}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">{t("app.name")}</h1>
          <span
            className="text-2xl font-medium"
            style={{ color: alarm.length === 0 ? "var(--status-operational)" : "var(--status-major-outage)" }}
          >
            {alarm.length === 0
              ? t("wallboard.all-well", { count: providers.length })
              : t("wallboard.alarm", { count: alarm.length, total: providers.length })}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-lg text-muted-foreground">
            {status?.lastPollAt == null
              ? t("meta.never-polled")
              : t("wallboard.polled", { time: formatTime(i18n.language, status.lastPollAt) })}
          </span>
          {pages > 1 && (
            <span className="font-mono text-lg text-muted-foreground">
              {t("wallboard.page", { current: page + 1, total: pages })}
            </span>
          )}
          {/* The only two controls, and both of them are about the screen
              rather than about the fleet: make it fill the wall, or stop. */}
          <button
            type="button"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label={t("wallboard.fullscreen")}
            onClick={goFullscreen}
          >
            <Maximize2 className="size-5" aria-hidden="true" />
          </button>
          <Link
            to={ROUTE_PATHS.overview}
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label={t("wallboard.exit")}
          >
            <X className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {providers.length === 0 ? (
        <p className="text-2xl text-muted-foreground">{t("providers.empty")}</p>
      ) : (
        // Rows sized by their content rather than stretched to the viewport: a
        // fleet of three would otherwise become three half-empty columns a
        // metre tall, which reads as a broken screen rather than a calm one.
        <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((provider) => (
            <article
              key={provider.id}
              className="flex min-h-40 flex-col justify-between gap-3 rounded-lg border p-5"
              style={{
                // The tile itself carries the status, because at four metres a
                // dot is not a signal — the whole card has to be the signal.
                borderColor: statusColor(provider.overallStatus),
                background: `color-mix(in srgb, ${statusFill(provider.overallStatus)} 12%, transparent)`,
              }}
            >
              <div className="flex flex-col gap-1">
                <span className="truncate text-2xl font-semibold">{provider.name}</span>
                <span className="text-xl" style={{ color: statusColor(provider.overallStatus) }}>
                  {t(statusLabelKey(provider.overallStatus))}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-3xl tabular-nums">
                  {formatPercent(i18n.language, provider.uptime90)}
                </span>
                {provider.activeIncidents.length > 0 && (
                  <span className="text-lg text-muted-foreground">
                    {t("wallboard.incidents", { count: provider.activeIncidents.length })}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
