import { createHash } from "node:crypto";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { parseHtml, selectText, textOf } from "./htmlSelect.ts";

/**
 * The content watchdog — roadmap 1.12. For the page that is only prose ("All
 * systems normal") and that not even the scrape adapter's status words fit:
 * it reports any *change* in the page's text against a baseline the operator
 * wrote down, and makes no attempt to say what the change means.
 *
 * Low on meaning by design, and honest about it:
 *
 * - the baseline is configuration, not memory. An adapter that learned it from
 *   its first read would re-learn it after a restart — and a page already
 *   changed by then would become the new normal, closing the very incident it
 *   should still be holding open;
 * - a page matching its baseline reads operational; one that does not reads
 *   degraded, the least severe word that still is not "fine", with one open
 *   incident whose title is the new text. Its id is the text's fingerprint, so
 *   a page that changes again opens a second incident instead of quietly
 *   rewording the first, and a page that changes back resolves it;
 * - a missing baseline or a selector that matches nothing throws, the way the
 *   scrape adapter does, so a misconfiguration is a failing provider rather
 *   than a reading nobody ordered.
 */

const ACCEPT = "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.5";

/** Longest new text carried as the incident title — enough to read, short enough for a phone. */
const TITLE_LIMIT = 280;

/**
 * What counts as the same text: whitespace collapsed and case folded. A page
 * that re-wraps a line or capitalises a word has not said anything new.
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

function fingerprint(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 12);
}

function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= TITLE_LIMIT ? collapsed : `${collapsed.slice(0, TITLE_LIMIT - 1)}…`;
}

/** The page's text: the element the selector names, or the whole document when none is set. */
export function pageText(html: string, service: ServiceRef): string {
  const selector = service.options?.["selector"]?.trim() ?? "";
  if (selector === "") return textOf(parseHtml(html));
  const text = selectText(html, selector);
  if (text === null) {
    throw new Error(`watchdog for ${service.id}: selector ${selector} matched nothing on ${service.baseUrl}`);
  }
  return text;
}

/** Pure mapping from a fetched page to a reading, exported for the fixture suite. */
export function parseWatchedPage(html: string, service: ServiceRef): NormalizedStatus {
  const text = pageText(html, service);
  const baseline = service.options?.["baseline"] ?? "";
  if (normalizeText(baseline) === "") {
    // Says what the page reads now, so the error itself is the way to set one.
    throw new Error(`watchdog for ${service.id} has no "baseline" option — the page currently reads: "${excerpt(text)}"`);
  }
  const fetchedAt = new Date().toISOString();
  const changed = normalizeText(text) !== normalizeText(baseline);
  return {
    provider: service.id,
    overallStatus: changed ? "degraded" : "operational",
    activeIncidents: changed
      ? [{ id: `changed-${fingerprint(text)}`, name: excerpt(text), impact: "", status: "changed", updatedAt: fetchedAt }]
      : [],
    components: [],
    maintenances: [],
    fetchedAt,
  };
}

export const watchdogAdapter: Adapter = {
  id: "watchdog",
  version: 1,

  validateOptions(options) {
    return normalizeText(options?.["baseline"] ?? "") === ""
      ? ['a "baseline" option is required: the text the page reads while nothing is wrong']
      : [];
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const html = await fetchConditional(service.baseUrl, {
      providerId: service.id,
      accept: ACCEPT,
      timeoutMs: ctx.timeoutMs,
      onRead: ctx.onRead,
      auth: service.options,
      label: "watchdog fetch",
    });
    return parseWatchedPage(html, service);
  },
};
