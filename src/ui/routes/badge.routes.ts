import { Router } from "express";
import { listServices, readSettings } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import type { OverallStatus } from "../../core/types.ts";

/**
 * Two read-only endpoints aimed outward rather than at the dashboard (roadmap
 * 4.8 and 4.11): an SVG badge for a README, and one summary JSON in the shape
 * the homelab dashboards (`homepage`, Dashy) already know how to draw.
 *
 * Both are pure reads of stored state — no provider is contacted, nothing is
 * recorded — so a README rendered by every visitor to a repository, or a home
 * page polling every ten seconds, costs a SQLite read and nothing upstream.
 */

/**
 * Badge colours by severity, in Shields' own palette so a row of badges from
 * different services still reads as one row. `unknown` is grey rather than
 * green: a provider we have never read is not a provider that is fine.
 */
const COLORS: Record<OverallStatus, string> = {
  operational: "#3fb950",
  degraded: "#d29922",
  partial_outage: "#db6d28",
  major_outage: "#f85149",
  unknown: "#8b949e",
};

/** Label text per severity. Deliberately English: a badge has no request locale worth reading. */
const LABELS: Record<OverallStatus, string> = {
  operational: "operational",
  degraded: "degraded",
  partial_outage: "partial outage",
  major_outage: "major outage",
  unknown: "unknown",
};

/**
 * Shields' own width heuristic: a 7px average advance per character plus
 * padding. It is an estimate — the real answer needs font metrics — and it is
 * the same estimate Shields makes, which is why their badges have looked like
 * this for a decade.
 */
const textWidth = (text: string): number => Math.round(text.length * 6.5) + 20;

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (character) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character,
  );

/**
 * A flat badge, written out rather than fetched from shields.io: the endpoint
 * has to work on an instance with no outbound internet access, and it is forty
 * lines of SVG.
 */
export function renderBadge(label: string, message: string, color: string): string {
  const labelWidth = textWidth(label);
  const messageWidth = textWidth(message);
  const total = labelWidth + messageWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + messageWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${labelWidth + messageWidth / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>
`;
}

/** The worst reading in the fleet, which is what a single-badge summary has to say. */
const RANK: OverallStatus[] = ["unknown", "operational", "degraded", "partial_outage", "major_outage"];

const worst = (statuses: OverallStatus[]): OverallStatus =>
  statuses.reduce<OverallStatus>(
    (found, status) => (RANK.indexOf(status) > RANK.indexOf(found) ? status : found),
    "unknown",
  );

export function badgeRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const db = runtime.db;

  /**
   * `/badge/github.svg`, plus `/badge.svg` for the whole fleet.
   *
   * A badge is embedded in a README that is cached hard by GitHub's camo proxy,
   * so the response asks for a short cache rather than none: long enough that a
   * popular README does not become a load generator, short enough that a badge
   * is not still green an hour into an outage.
   */
  const sendBadge = (res: Parameters<Parameters<Router["get"]>[1]>[1], label: string, status: OverallStatus): void => {
    res
      .type("image/svg+xml")
      .set("cache-control", "max-age=60, s-maxage=60")
      .send(renderBadge(label, LABELS[status], COLORS[status]));
  };

  router.get("/badge.svg", async (_req, res) => {
    const services = listServices(db).filter((service) => service.enabled);
    const statuses = await Promise.all(
      services.map(async (service) => (await runtime.store.getState(service.id)).last?.overallStatus ?? "unknown"),
    );
    sendBadge(res, "status", worst(statuses));
  });

  router.get("/badge/:providerId.svg", async (req, res) => {
    const service = listServices(db).find((entry) => entry.id === req.params.providerId);
    if (service === undefined) {
      // A badge, not a JSON error: whatever went wrong, what is on the page is
      // an image, and "unknown provider" is more use there than a broken image
      // icon. 404 so a script can still tell.
      res.status(404);
      sendBadge(res, req.params.providerId, "unknown");
      return;
    }
    const state = await runtime.store.getState(service.id);
    sendBadge(res, service.name, state.last?.overallStatus ?? "unknown");
  });

  /**
   * One summary object for a homelab home page's custom-API widget.
   *
   * The shape is deliberately flat and small — counts and one worst-status
   * word, no nested history — because those widgets render a handful of
   * key/value pairs and poll often.
   */
  router.get("/widget", async (_req, res) => {
    const services = listServices(db).filter((service) => service.enabled);
    const states = await Promise.all(
      services.map(async (service) => ({
        service,
        state: await runtime.store.getState(service.id),
      })),
    );

    const statuses = states.map(({ state }) => state.last?.overallStatus ?? "unknown");
    const incidents = states.reduce((total, { state }) => total + (state.last?.activeIncidents.length ?? 0), 0);
    const { retentionDays } = readSettings(db, runtime.logger);

    res.json({
      status: worst(statuses),
      providers: services.length,
      operational: statuses.filter((status) => status === "operational").length,
      degraded: statuses.filter((status) => status === "degraded").length,
      down: statuses.filter((status) => status === "partial_outage" || status === "major_outage").length,
      unknown: statuses.filter((status) => status === "unknown").length,
      muted: services.filter((service) => service.mutedUntil !== undefined).length,
      incidents,
      lastPollAt: runtime.lastCycleAt(),
      retentionDays,
    });
  });

  return router;
}
