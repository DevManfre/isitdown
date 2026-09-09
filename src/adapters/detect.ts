import { fetchConditional } from "../core/http.ts";

/**
 * Which adapter reads a given status page, worked out by asking it (roadmap
 * 1.14).
 *
 * Nine adapters exist now, and the add-provider form asks the operator to pick
 * one of them plus the base url each expects — two answers that are only
 * obvious to whoever wrote the adapters. Every shape read here announces itself
 * in a document at a known path, so the shapes can be tried in turn instead:
 * one read per candidate, first match wins.
 *
 * Read-only towards the fleet, exactly like the connection test and the
 * component preview: detection records nothing, notifies nothing and touches no
 * state. It is deliberately in `src/adapters` rather than in an edition — it is
 * knowledge about adapters, and the Light edition's config file has the same
 * two fields to fill in.
 */

/** How the probe of one candidate ended, so the caller can say what was tried. */
export interface DetectionProbe {
  adapter: string;
  url: string;
  outcome: "match" | "other-shape" | "unreachable";
}

export interface Detection {
  /** The adapter that recognised the page, or null when none did. */
  adapter: string | null;
  /** The base url that adapter expects, ready for the service definition. */
  baseUrl: string | null;
  probes: DetectionProbe[];
}

/**
 * The four adapters written for one provider each. Their document lives at a
 * path nothing else serves, but probing for it is pointless: the host is the
 * evidence, and a match here saves four requests to a page we already know.
 */
const KNOWN_HOSTS: { host: string; adapter: string }[] = [
  { host: "health.aws.amazon.com", adapter: "aws" },
  { host: "status.cloud.google.com", adapter: "gcp" },
  { host: "azure.status.microsoft", adapter: "azure" },
  { host: "status.azure.com", adapter: "azure" },
  { host: "slack-status.com", adapter: "slack" },
];

const JSON_ACCEPT = "application/json";
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml";

/** True when the body is JSON whose top level answers `shape`. */
const jsonShaped =
  (shape: (value: Record<string, unknown>) => boolean) =>
  (body: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return shape(parsed as Record<string, unknown>);
  };

const isObject = (value: unknown): boolean => value !== null && typeof value === "object" && !Array.isArray(value);

interface Candidate {
  adapter: string;
  /** Appended to the origin to read the document that identifies the shape. */
  path: string;
  accept: string;
  /**
   * The base url the adapter itself wants: the origin for an adapter that
   * appends its own path, the document's own url for one that reads a feed
   * verbatim.
   */
  baseUrl: (origin: string, url: string) => string;
  matches: (body: string) => boolean;
}

/**
 * Tried in this order, and the order is the point: the two aggregate JSON
 * documents that identify themselves precisely come before the feed paths,
 * which are guesses. A Statuspage page also publishes `/history.rss`, so a feed
 * probe running first would file every Statuspage provider under the generic
 * feed adapter and lose the components, the maintenance windows and the
 * incident attribution the real adapter reads.
 */
const CANDIDATES: Candidate[] = [
  {
    adapter: "statuspage",
    path: "/api/v2/summary.json",
    accept: JSON_ACCEPT,
    baseUrl: (origin) => origin,
    // The page-wide indicator or the component list, either of which only a
    // Statuspage summary serves at this path. `page` is not required: it is the
    // provider's own metadata, and a document carrying the indicator is already
    // this shape.
    matches: jsonShaped((body) => isObject(body["status"]) || Array.isArray(body["components"])),
  },
  {
    adapter: "instatus",
    path: "/summary.json",
    accept: JSON_ACCEPT,
    baseUrl: (origin) => origin,
    matches: jsonShaped(
      (body) => isObject(body["page"]) && (Array.isArray(body["activeIncidents"]) || Array.isArray(body["activeMaintenances"])),
    ),
  },
  {
    adapter: "betterstack",
    path: "/index.json",
    accept: JSON_ACCEPT,
    baseUrl: (origin) => origin,
    matches: jsonShaped((body) => isObject(body["data"]) && Array.isArray(body["included"])),
  },
  // The feed adapter reads whatever url it is given, so a matching feed hands
  // back its own url rather than the origin.
  ...["/history.rss", "/feed", "/index.xml"].map((path) => ({
    adapter: "rss",
    path,
    accept: FEED_ACCEPT,
    baseUrl: (_origin: string, url: string) => url,
    matches: (body: string) => /<(rss|feed)[\s>]/i.test(body.slice(0, 2048)),
  })),
];

/**
 * The origin of whatever the operator pasted: a bare host, a status page's home
 * page, or the summary document itself. The path is discarded on purpose — every
 * adapter builds its own, so keeping it would produce base urls like
 * `.../api/v2/summary.json/api/v2/summary.json`.
 *
 * Throws when the input is not a url at all, which is the one detection failure
 * that is the request's fault rather than the provider's.
 */
export function originOf(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") throw new Error("nothing to detect: the url is empty");
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.hostname === "") throw new Error(`not a url: ${input}`);
  return url.origin;
}

export async function detectAdapter(input: string, ctx: { timeoutMs: number }): Promise<Detection> {
  const origin = originOf(input);
  const { hostname } = new URL(origin);

  const known = KNOWN_HOSTS.find((entry) => hostname === entry.host || hostname.endsWith(`.${entry.host}`));
  if (known !== undefined) {
    return { adapter: known.adapter, baseUrl: origin, probes: [] };
  }

  const probes: DetectionProbe[] = [];
  for (const candidate of CANDIDATES) {
    const url = `${origin}${candidate.path}`;
    let body: string;
    try {
      body = await fetchConditional(url, {
        // Scoped so a detection cannot replay a monitored provider's cached
        // body, or leave its own behind under a real provider's id.
        providerId: `detect:${hostname}`,
        accept: candidate.accept,
        timeoutMs: ctx.timeoutMs,
        label: "detect fetch",
      });
    } catch {
      // A 404 is the ordinary answer here — the page simply does not serve this
      // shape — and a timeout or a refused connection says the same thing about
      // this candidate. Neither is worth failing the whole detection over.
      probes.push({ adapter: candidate.adapter, url, outcome: "unreachable" });
      continue;
    }
    if (candidate.matches(body)) {
      probes.push({ adapter: candidate.adapter, url, outcome: "match" });
      return { adapter: candidate.adapter, baseUrl: candidate.baseUrl(origin, url), probes };
    }
    // Answered, but with something else: an SPA's index.html served for every
    // path is the common one, and it is why a 200 alone is not a match.
    probes.push({ adapter: candidate.adapter, url, outcome: "other-shape" });
  }

  return { adapter: null, baseUrl: null, probes };
}
