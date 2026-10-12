import { z } from "zod";
import { USER_AGENT } from "../core/http.ts";

/**
 * When a domain registration runs out — roadmap 2.7, read over RDAP, the
 * registries' public JSON successor to WHOIS.
 *
 * A lapsed domain is the TLS certificate's slower cousin: everything works
 * until the day nothing resolves, and the warning went to an inbox nobody
 * reads. IANA publishes which registry answers for each TLD; the registry
 * answers with the domain's events, `expiration` among them.
 *
 * Read rarely and kept: the date moves once a year, and a dns probe on a
 * ten-second cadence asking a registry each time would be rate limited within
 * the hour. A failed lookup is remembered for an hour so a registry that is
 * down is not asked again on every cycle either. Not every registry publishes
 * an expiry (several ccTLDs do not), which is an answer, not an error.
 */

export const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

const BOOTSTRAP_TTL_MS = 24 * 3600_000;
const ANSWER_TTL_MS = 12 * 3600_000;
const FAILURE_TTL_MS = 3600_000;

export type ExpiryLookup =
  | { found: true; expiresAt: string }
  | { found: false; reason: string };

type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

const bootstrapSchema = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
});

const domainSchema = z
  .object({
    events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

let bootstrap: { at: number; byTld: Map<string, string> } | null = null;
const answers = new Map<string, { at: number; ttl: number; lookup: ExpiryLookup }>();

/** Forgets everything read — for the tests, which each start from nothing. */
export function resetRdapCache(): void {
  bootstrap = null;
  answers.clear();
}

async function getJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/rdap+json, application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) throw new Error("the registry does not know this domain");
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

async function registryFor(tld: string, fetcher: Fetcher, timeoutMs: number, now: number): Promise<string | undefined> {
  if (bootstrap === null || now - bootstrap.at > BOOTSTRAP_TTL_MS) {
    const parsed = bootstrapSchema.parse(await getJson(fetcher, IANA_BOOTSTRAP_URL, timeoutMs));
    const byTld = new Map<string, string>();
    for (const [tlds, urls] of parsed.services) {
      const base = urls.find((url) => url.startsWith("https://")) ?? urls[0];
      if (base === undefined) continue;
      for (const entry of tlds) byTld.set(entry.toLowerCase(), base.endsWith("/") ? base : `${base}/`);
    }
    bootstrap = { at: now, byTld };
  }
  return bootstrap.byTld.get(tld);
}

/** The `expiration` event a registry publishes for `domain` — a registrable domain, `example.co.uk`. */
export async function domainExpiry(
  domain: string,
  opts: { timeoutMs: number; fetcher?: Fetcher | undefined; now?: number | undefined },
): Promise<ExpiryLookup> {
  const now = opts.now ?? Date.now();
  const key = domain.toLowerCase();
  const cached = answers.get(key);
  if (cached !== undefined && now - cached.at < cached.ttl) return cached.lookup;

  const fetcher: Fetcher = opts.fetcher ?? fetch;
  let lookup: ExpiryLookup;
  try {
    const tld = key.split(".").pop() ?? "";
    const registry = await registryFor(tld, fetcher, opts.timeoutMs, now);
    if (registry === undefined) {
      lookup = { found: false, reason: `the .${tld} registry publishes no RDAP service` };
    } else {
      const parsed = domainSchema.parse(await getJson(fetcher, `${registry}domain/${key}`, opts.timeoutMs));
      const expiration = (parsed.events ?? []).find((event) => event.eventAction === "expiration");
      const at = expiration === undefined ? Number.NaN : Date.parse(expiration.eventDate);
      lookup = Number.isNaN(at)
        ? { found: false, reason: `the .${tld} registry publishes no expiry date` }
        : { found: true, expiresAt: new Date(at).toISOString() };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    answers.set(key, { at: now, ttl: FAILURE_TTL_MS, lookup: { found: false, reason } });
    return { found: false, reason };
  }
  answers.set(key, { at: now, ttl: ANSWER_TTL_MS, lookup });
  return lookup;
}
