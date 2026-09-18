import { formatUtc, t } from "../core/i18n/index.ts";
import { isActive } from "../core/maintenance.ts";
import type { MaintenanceWindow, OverallStatus } from "../core/types.ts";
import type { UiRuntimeCore } from "./runtime.ts";

/**
 * The public read-only status page — roadmap 5.1.
 *
 * The row called this the biggest product decision in the file, and it is: every
 * other surface here assumes one operator on one machine, and this one is meant
 * to be read by people who are not that operator. So the whole design is about
 * what it *cannot* do rather than what it shows.
 *
 * Three rules, and the code is arranged so that breaking one takes real effort:
 *
 * 1. **Off unless asked for.** `PUBLIC_PAGE=true`. An upgrade must never begin
 *    publishing an installation's vendor list to anybody who can reach the port.
 * 2. **A separate projection, not a filtered dashboard.** `publicSummary` below
 *    builds its own object out of named fields. A dashboard payload with the
 *    private parts stripped would leak the next field somebody adds to it; this
 *    one leaks nothing unless a person writes the line that leaks it. Nothing
 *    about adapters, base URLs, channels, routing, mutes or failure counts has
 *    a line here.
 * 3. **Its own HTML, not the dashboard bundle.** The page is one self-contained
 *    document with no script in it. It cannot call `/config`, because it cannot
 *    call anything: there is no JavaScript to make the call and no bundle whose
 *    next version might start making one.
 *
 * What it is *not* is authentication. Anyone who can reach the port can read
 * this page, which is the entire point of it — so the operator chooses which
 * providers appear (`PUBLIC_PAGE_PROVIDERS`) and the default, an installation
 * that never sets it, is every provider it already watches.
 */

export interface PublicPageSettings {
  enabled: boolean;
  title: string;
  /** Empty means every enabled provider. */
  providers: string[];
  locale: string | undefined;
}

export function readPublicPageSettings(env: NodeJS.ProcessEnv): PublicPageSettings {
  return {
    enabled: (env["PUBLIC_PAGE"] ?? "").trim().toLowerCase() === "true",
    title: (env["PUBLIC_PAGE_TITLE"] ?? "").trim() || "Service status",
    providers: (env["PUBLIC_PAGE_PROVIDERS"] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
    locale: (env["PUBLIC_PAGE_LOCALE"] ?? "").trim() || undefined,
  };
}

/** One day of a provider's 90-day strip. */
export interface PublicDay {
  day: string;
  status: OverallStatus;
  uptime: number | null;
}

export interface PublicProvider {
  id: string;
  name: string;
  status: OverallStatus;
  /** The provider's own status page, which is public by definition. */
  statusUrl: string | null;
  uptime90: number | null;
  days: PublicDay[];
  openIncidents: { title: string; status: string; updatedAt: string }[];
  maintenance: { title: string; endsAt: string | null } | null;
}

export interface PublicSummary {
  title: string;
  /** The worst status across the published providers — what the banner says. */
  overall: OverallStatus;
  generatedAt: string;
  providers: PublicProvider[];
}

/**
 * Adapters whose `baseUrl` is *ours* rather than the vendor's: a direct HTTP
 * probe (roadmap 1.8), a TCP or DNS check, a self-hosted Uptime Kuma. Every
 * other adapter points at a third party's own public status page, which is
 * public by definition and safe to link.
 *
 * This is the one place on this page where a leak was genuinely easy to write.
 * `statusUrl` is `baseUrl` everywhere else in the codebase, and for these four
 * that is an internal hostname — `https://billing.internal.acme.corp/health` —
 * which publishing would hand a stranger a map of the operator's network. The
 * provider still appears on the page, under the name the operator gave it; only
 * the link is withheld.
 *
 * A deny-list rather than an allow-list because a plugin adapter (roadmap 1.13)
 * reads a vendor's page like the built-in ones do, and would otherwise silently
 * lose its link. A plugin that probes the operator's own infrastructure should
 * be named here, and the docs say so.
 */
const PRIVATE_BASE_URL_ADAPTERS = new Set(["http", "tcp", "dns", "uptimekuma"]);

const SEVERITY: OverallStatus[] = [
  "operational",
  "unknown",
  "degraded",
  "partial_outage",
  "major_outage",
];

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

/**
 * The published projection.
 *
 * Every field is written out by hand — see rule 2 above. Adding a field to the
 * dashboard's `/status` must not add one here, and it cannot, because these two
 * objects share no code.
 */
export async function publicSummary(
  runtime: UiRuntimeCore,
  settings: PublicPageSettings,
): Promise<PublicSummary> {
  const generatedAt = new Date().toISOString();
  const config = await runtime.configSource.load();
  const wanted = new Set(settings.providers);
  const services = runtime
    .listAllServices()
    .filter((service) => service.enabled)
    .filter((service) => wanted.size === 0 || wanted.has(service.id));

  const providers = await Promise.all(
    services.map(async (service): Promise<PublicProvider> => {
      const state = await runtime.store.getState(service.id);
      const last = state.last;
      const history = await runtime.history
        .getProviderHistory(service.id, 90, config.polling.intervalMinutes)
        .catch(() => null);
      const running = (last?.maintenances ?? []).find((window: MaintenanceWindow) =>
        isActive(window, generatedAt),
      );

      return {
        id: service.id,
        name: service.name,
        status: last?.overallStatus ?? "unknown",
        statusUrl: PRIVATE_BASE_URL_ADAPTERS.has(service.adapter) ? null : service.baseUrl,
        uptime90: history === null || history.sampleCount === 0 ? null : history.uptime90,
        days:
          history === null
            ? []
            : history.buckets.map((bucket, index) => ({
                day: bucket.day,
                status: bucket.status,
                uptime: history.dailySeries[index]?.uptime ?? null,
              })),
        // The provider's own published incident titles. Already public on the
        // vendor's status page, which is where they were read from — nothing
        // here is IsItDown's own observation about them.
        openIncidents: (last?.activeIncidents ?? []).map((incident) => ({
          title: incident.name,
          status: incident.status,
          updatedAt: incident.updatedAt,
        })),
        maintenance: running === undefined ? null : { title: running.name, endsAt: running.endsAt },
      };
    }),
  );

  providers.sort((left, right) => left.name.localeCompare(right.name));
  const overall = providers.reduce<OverallStatus>(
    (worst, provider) =>
      SEVERITY.indexOf(provider.status) > SEVERITY.indexOf(worst) ? provider.status : worst,
    "operational",
  );

  return { title: settings.title, overall, generatedAt, providers };
}

/**
 * Text into HTML.
 *
 * Every interpolation below goes through this, without exception. A provider's
 * incident title is somebody else's copy arriving over the network, and this
 * page is the one surface here that strangers read: an unescaped title is a
 * cross-site scripting hole that a vendor could open on our page by naming an
 * incident.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const uptimeLabel = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)}%`);

function dayBars(days: PublicDay[], locale: string): string {
  // Ninety cells, oldest first, exactly the shape the dashboard's uptime strip
  // has — the familiar status-page gesture, and the one thing a visitor reads
  // before anything else.
  return days
    .map((day) => {
      const label =
        day.uptime === null
          ? `${day.day} · ${t(locale, "status.unknown")}`
          : `${day.day} · ${uptimeLabel(day.uptime)}`;
      return `<span class="bar bar--${day.status.replace(/_/g, "-")}" title="${escapeHtml(label)}"></span>`;
    })
    .join("");
}

function providerCard(provider: PublicProvider, locale: string): string {
  const name =
    provider.statusUrl === null
      ? escapeHtml(provider.name)
      : `<a href="${escapeHtml(provider.statusUrl)}" rel="noreferrer noopener nofollow">${escapeHtml(provider.name)}</a>`;

  const incidents = provider.openIncidents
    .map(
      (incident) =>
        `<li><strong>${escapeHtml(incident.title)}</strong> — ${escapeHtml(incident.status)} · <time>${escapeHtml(formatUtc(incident.updatedAt))}</time></li>`,
    )
    .join("");

  const maintenance =
    provider.maintenance === null
      ? ""
      : `<p class="note note--maintenance">${escapeHtml(
          t(locale, "public.maintenance", {
            title: provider.maintenance.title,
            endsAt:
              provider.maintenance.endsAt === null
                ? t(locale, "maintenance.no-end")
                : formatUtc(provider.maintenance.endsAt),
          }),
        )}</p>`;

  return `
      <article class="card" id="${escapeHtml(provider.id)}">
        <header class="card__head">
          <h2>${name}</h2>
          <span class="pill pill--${provider.status.replace(/_/g, "-")}">${escapeHtml(t(locale, STATUS_KEY[provider.status]))}</span>
        </header>
        <div class="strip" role="img" aria-label="${escapeHtml(t(locale, "public.strip-label", { uptime: uptimeLabel(provider.uptime90) }))}">${dayBars(provider.days, locale)}</div>
        <p class="scale"><span>${escapeHtml(t(locale, "public.ninety-days-ago"))}</span><span>${escapeHtml(t(locale, "public.uptime90", { uptime: uptimeLabel(provider.uptime90) }))}</span><span>${escapeHtml(t(locale, "public.today"))}</span></p>
        ${maintenance}
        ${incidents === "" ? "" : `<ul class="incidents">${incidents}</ul>`}
      </article>`;
}

/**
 * The whole page, in one document with no script and no external request.
 *
 * Self-contained on purpose: a status page is read precisely when things are
 * broken, and a page that needs a font server, a CDN or an API call to render
 * is a page that fails during the outage it exists to report. The fonts are the
 * reader's own, the CSS is inline, and there is no JavaScript at all — so the
 * page cannot be made to call the dashboard's API by a later change, because
 * there is nothing here that could call anything.
 */
export function renderPublicPage(summary: PublicSummary, locale: string): string {
  const bannerKey =
    summary.overall === "operational" ? "public.banner.operational" : "public.banner.degraded";
  const banner = t(locale, bannerKey, { count: summary.providers.length });

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(summary.title)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f7f7f8; --surface: #ffffff; --text: #18181b; --muted: #71717a;
  --divider: rgba(24, 24, 27, 0.12);
  --operational: #16a34a; --degraded: #bd8404; --partial-outage: #ea580c;
  --major-outage: #dc2626; --unknown: #d4d4d8; --accent: #473c9e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161826; --surface: #232532; --text: #e9e9ed; --muted: #a1a1aa;
    --divider: rgba(233, 233, 237, 0.16); --unknown: #3f3f46; --accent: #7466dc;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem 4rem; background: var(--bg); color: var(--text);
  font: 400 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 56rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; letter-spacing: -0.01em; }
.banner {
  display: flex; align-items: center; gap: .625rem; margin: 1.25rem 0 1.75rem;
  padding: .875rem 1rem; border-radius: .75rem; background: var(--surface);
  border: 1px solid var(--divider); font-weight: 500;
}
.banner::before { content: ""; width: .625rem; height: .625rem; border-radius: 50%; background: var(--dot); flex: none; }
.banner--operational { --dot: var(--operational); }
.banner--degraded { --dot: var(--major-outage); }
.card {
  background: var(--surface); border: 1px solid var(--divider); border-radius: .75rem;
  padding: 1rem 1.125rem; margin-bottom: .875rem;
}
.card__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .875rem; }
.card__head h2 { font-size: 1rem; font-weight: 600; margin: 0; }
.card__head a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--divider); }
.card__head a:hover { border-bottom-color: currentColor; }
.pill { font-size: .8125rem; font-weight: 500; white-space: nowrap; color: var(--dot); }
.pill--operational { --dot: var(--operational); }
.pill--degraded { --dot: var(--degraded); }
.pill--partial-outage { --dot: var(--partial-outage); }
.pill--major-outage { --dot: var(--major-outage); }
.pill--unknown { --dot: var(--muted); }
/* The 90-day strip. Flexed rather than gridded so a narrow phone squeezes the
   bars instead of scrolling the page sideways. */
.strip { display: flex; gap: 2px; height: 2.125rem; align-items: stretch; }
.bar { flex: 1 1 0; min-width: 1px; border-radius: 2px; background: var(--unknown); }
.bar--operational { background: var(--operational); }
.bar--degraded { background: var(--degraded); }
.bar--partial-outage { background: var(--partial-outage); }
.bar--major-outage { background: var(--major-outage); }
.scale { display: flex; justify-content: space-between; gap: 1rem; margin: .5rem 0 0; font-size: .75rem; color: var(--muted); }
.note { margin: .75rem 0 0; font-size: .8125rem; }
.note--maintenance { color: var(--accent); }
.incidents { margin: .75rem 0 0; padding-left: 1.1rem; font-size: .8125rem; }
.incidents li { margin-bottom: .25rem; }
.incidents time { color: var(--muted); }
footer { margin-top: 2rem; font-size: .75rem; color: var(--muted); text-align: center; }
.empty { color: var(--muted); }
@media (max-width: 34rem) {
  body { padding: 1.25rem .75rem 3rem; }
  .card__head { flex-direction: column; align-items: flex-start; gap: .25rem; }
  .strip { height: 1.75rem; }
}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(summary.title)}</h1>
  <p class="banner banner--${summary.overall === "operational" ? "operational" : "degraded"}">${escapeHtml(banner)}</p>
  ${
    summary.providers.length === 0
      ? `<p class="empty">${escapeHtml(t(locale, "public.empty"))}</p>`
      : summary.providers.map((provider) => providerCard(provider, locale)).join("\n")
  }
  <footer>${escapeHtml(t(locale, "public.generated", { at: formatUtc(summary.generatedAt) }))}</footer>
</main>
</body>
</html>
`;
}
