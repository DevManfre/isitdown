import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { selectText } from "./htmlSelect.ts";

/**
 * The last-resort adapter: one CSS selector and a status-word mapping, for the
 * pages that publish neither JSON nor a feed. Sorry™ is the reason it exists —
 * it has no unauthenticated machine-readable endpoint at all — and behind it
 * sits a long tail of pages that only ever say how they are in prose.
 *
 * It is fragile by nature, and the whole design is about making that fragility
 * loud rather than quiet:
 *
 * - a selector that matches nothing throws, so a page whose structure moved
 *   fails like an unreachable provider (retries, then the monitoring-degraded
 *   warning) instead of settling into a permanent reading nobody ordered;
 * - text that matches no configured word reads `unknown`, never `operational`.
 *   "We could not tell" and "everything is fine" are the two answers that must
 *   never be confused, because only one of them is worth an alert;
 * - the words are matched worst-first, so a page saying "partial outage on the
 *   API, everything else operational" reads as the outage.
 *
 * There are no incidents, components or maintenance windows here: a page that
 * needed scraping has no structure to read them out of. The reading is one
 * severity and nothing more.
 */

/** Accepted by any page; the adapter reads `baseUrl` verbatim, like the feed one. */
const ACCEPT = "text/html, application/xhtml+xml;q=0.9, */*;q=0.8";

/**
 * Words a page is assumed to use when the operator configures none.
 *
 * `operational` is listed last, and the severities are declared worst first,
 * because that is the tiebreak: where two words are equally specific, the worse
 * reading wins.
 */
const DEFAULT_WORDS: [OverallStatus, string[]][] = [
  ["major_outage", ["major outage", "outage", "down", "offline", "unavailable", "unreachable", "not working"]],
  ["partial_outage", ["partial outage", "partial", "some systems"]],
  ["degraded", ["degraded", "degraded performance", "minor", "elevated errors", "slow", "issues"]],
  ["operational", ["operational", "all systems go", "no known issues", "healthy", "normal", "up"]],
];

const SEVERITY_KEYS: OverallStatus[] = ["major_outage", "partial_outage", "degraded", "operational"];

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word matching, so `up` in "backup" is not a provider telling us it is
 * fine. A configured phrase keeps its inner spaces and is matched as typed.
 */
const says = (text: string, word: string): boolean => new RegExp(`(^|\\W)${escape(word)}($|\\W)`, "i").test(text);

const words = (raw: string | undefined): string[] =>
  (raw ?? "").split(",").map((word) => word.trim()).filter((word) => word !== "");

/**
 * The mapping this service reads with: whatever the operator configured for a
 * severity, and the defaults for the severities they left alone. Configuring
 * one severity is a common case — a page with an unusual word for "fine" and
 * ordinary words for everything else — and it must not silently blank the rest.
 */
function wordMap(options: Record<string, string> | undefined): [OverallStatus, string[]][] {
  return DEFAULT_WORDS.map(([severity, defaults]) => {
    const configured = words(options?.[severity]);
    return [severity, configured.length > 0 ? configured : defaults] as [OverallStatus, string[]];
  });
}

/**
 * The severity the text reads as, or `unknown` when no configured word appears
 * in it.
 *
 * The most specific wording on the page decides: a banner saying "partial
 * outage on the API, everything else operational" reads as the partial outage,
 * because "partial outage" is a longer match than either "outage" or
 * "operational". Where two words are equally specific the worse severity wins,
 * so a page that manages to say two contradictory things is read pessimistically.
 */
export function severityFromPage(text: string, options?: Record<string, string> | undefined): OverallStatus {
  const candidates = wordMap(options)
    .flatMap(([severity, list], rank) => list.map((word) => ({ severity, word, rank })))
    .sort((left, right) => right.word.length - left.word.length || left.rank - right.rank);
  return candidates.find(({ word }) => says(text, word))?.severity ?? "unknown";
}

/**
 * Pure mapping from a page body to a status reading, exported so the whole
 * selector-and-words path is exercised with no network involved.
 *
 * Throws when the selector is missing, unsupported, or matches nothing on the
 * page — all three are a configuration or a page that moved, and all three have
 * to be visible rather than absorbed into a reading.
 */
export function parsePageStatus(html: string, service: ServiceRef): NormalizedStatus {
  const selector = service.options?.["selector"]?.trim();
  if (selector === undefined || selector === "") {
    throw new Error(`html scrape for ${service.id} has no "selector" option`);
  }

  const text = selectText(html, selector);
  if (text === null) {
    throw new Error(`html scrape for ${service.id}: selector ${selector} matched nothing on ${service.baseUrl}`);
  }

  return {
    provider: service.id,
    overallStatus: severityFromPage(text, service.options),
    // A scraped page offers no incident identity to track, and inventing one
    // per reading would open and resolve an incident on every poll.
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

/** The severity keys an operator may configure words for, for the settings form. */
export const HTML_SEVERITY_OPTIONS: readonly OverallStatus[] = SEVERITY_KEYS;

export const htmlAdapter: Adapter = {
  id: "html",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const html = await fetchConditional(service.baseUrl, {
      providerId: service.id,
      accept: ACCEPT,
      timeoutMs: ctx.timeoutMs,
      onRead: ctx.onRead,
      label: "html fetch",
    });
    return parsePageStatus(html, service);
  },
};
