/**
 * The one place a status page is read over HTTP.
 *
 * Adapters used to call `fetch` themselves, which meant every cycle downloaded
 * every provider's whole summary again even though most cycles see no change at
 * all. This helper remembers the validator a provider sent (`ETag`, or
 * `Last-Modified` for the pages that only send that) and offers it back on the
 * next read, so a quiet provider answers 304 with no body and the cached one is
 * replayed. Cheaper for them, politer of us, and it is the difference between
 * being rate-limited and not on a provider with a tight budget.
 *
 * A replay still costs a parse, deliberately: the reading's `fetchedAt` has to
 * be the time we asked, not the time the body was first served.
 */

/**
 * `Response.text()` is UTF-8 whatever the response said — the fetch spec has no
 * charset negotiation — and AWS publishes its health feed as UTF-16, which comes
 * back through it as mojibake that no JSON parser accepts. So the bytes are
 * decoded here, by the charset the provider declared, falling back to the byte
 * order mark and then to UTF-8.
 */
function decode(bytes: ArrayBuffer, contentType: string | null): string {
  const declared = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const view = new Uint8Array(bytes);
  const marked =
    view[0] === 0xfe && view[1] === 0xff ? "utf-16be" : view[0] === 0xff && view[1] === 0xfe ? "utf-16le" : undefined;
  // A declared utf-16 with no endianness is big-endian per the standard, but a
  // mark on the bytes themselves is the stronger evidence of the two.
  const charset = marked ?? (declared === "utf-16" ? "utf-16be" : declared) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(view);
  } catch {
    // An encoding this runtime has no decoder for. UTF-8 at least yields
    // something the adapter's own validation can reject with a clear message.
    return new TextDecoder().decode(view);
  }
}

/**
 * A provider that answered "not now": a 429, or any status carrying a
 * `Retry-After` header. It is a failed read like any other — the poller's
 * retry and failure accounting still apply — but it is the one failure that
 * says how long to stay away, and the poller holds the provider off until then
 * instead of asking again next cycle (roadmap 2.12).
 */
export class RetryAfterError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RetryAfterError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * How long a 429 without a `Retry-After` header is held off for. A rate limit
 * with no stated window is still a rate limit, and asking again on the next
 * tick is how a provider that is politely throttling us decides to stop
 * answering at all.
 */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * A hold is a promise not to ask, so it is bounded: a provider answering
 * `Retry-After: 604800` would otherwise take itself off the dashboard for a
 * week with no way for an operator to see why.
 */
const MAX_RETRY_AFTER_MS = 6 * 3600 * 1000;

/**
 * `Retry-After` is either a number of seconds or an HTTP date. Both are
 * accepted, as the spec allows either, and anything else reads as absent
 * rather than as zero — a malformed header must not turn a hold into a
 * hammering.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (value === "") return undefined;

  if (/^\d+$/.test(value)) {
    const ms = Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
    // "Retry-After: 0" states no window at all; a 429 then falls back to the
    // default below rather than to a hold that has already expired.
    return ms === 0 ? undefined : ms;
  }

  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  // A date already in the past is a provider saying "now", which is no window
  // either — same answer as above, so a stale date cannot become a hold of
  // zero that the caller has to special-case.
  const ms = Math.min(Math.max(at - now, 0), MAX_RETRY_AFTER_MS);
  return ms === 0 ? undefined : ms;
}

/** One completed read of a status page, reported so the caller can record it. */
export interface StatusPageRead {
  /**
   * Time to the response headers. The body transfer is deliberately outside it:
   * `fetch` resolves on the headers and a 304 carries no body at all, so
   * including the download would make a revalidated read look faster than a
   * full one for reasons that say nothing about the provider's health.
   */
  latencyMs: number;
  /** A 304 — a real round trip, but the body was replayed from the cache. */
  notModified: boolean;
}

interface CacheEntry {
  etag?: string | undefined;
  lastModified?: string | undefined;
  body: string;
}

export interface ConditionalFetchOptions {
  /** Scopes the cache: two providers may read the same url with their own validators. */
  providerId: string;
  accept: string;
  timeoutMs: number;
  /** Prefixes the error a failed read throws, e.g. "statuspage fetch". */
  label: string;
  /** Called once per successful read, a 304 included. A failed read reports nothing. */
  onRead?: ((read: StatusPageRead) => void) | undefined;
}

/**
 * Bounded so a provider removed from the dashboard, or an operator cycling
 * through base urls in the settings form, cannot pin bodies in memory forever.
 * A fleet reads a handful of endpoints per provider, so the cap is only ever
 * reached by churn, and the oldest entry losing its validator costs one
 * unconditional request.
 */
const MAX_ENTRIES = 256;

const cache = new Map<string, CacheEntry>();

const keyOf = (providerId: string, url: string): string => `${providerId}\n${url}`;

/** Drops everything cached for a provider — its rows are gone, so is its body. */
export function forgetProvider(providerId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${providerId}\n`)) cache.delete(key);
  }
}

/** Test seam: the cache is process-wide, so a test that asserts headers must start empty. */
export function resetValidators(): void {
  cache.clear();
}

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

/**
 * Reads a status page as text. Throws on a network error, a timeout or a
 * non-2xx answer so the poller's retry and failure accounting can act — a 304
 * is not one of those, it is a successful read of an unchanged page.
 */
export async function fetchConditional(url: string, opts: ConditionalFetchOptions): Promise<string> {
  const key = keyOf(opts.providerId, url);
  const cached = cache.get(key);

  const headers: Record<string, string> = { accept: opts.accept };
  if (cached?.etag !== undefined) headers["if-none-match"] = cached.etag;
  else if (cached?.lastModified !== undefined) headers["if-modified-since"] = cached.lastModified;

  let response: Response;
  const askedAt = Date.now();
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (error) {
    // A validator kept across a failure would be offered again next cycle; if
    // the failure was the provider objecting to it, that is a permanent stall.
    cache.delete(key);
    throw error;
  }

  const latencyMs = Date.now() - askedAt;

  if (response.status === 304) {
    if (cached !== undefined) {
      opts.onRead?.({ latencyMs, notModified: true });
      return cached.body;
    }
    // Only reachable from a provider answering 304 to a request that carried no
    // validator. There is no body to fall back on, and reporting an empty
    // reading would look like a provider with nothing wrong.
    throw new Error(`${opts.label} for ${opts.providerId}: HTTP 304 with nothing cached`);
  }

  if (!response.ok) {
    cache.delete(key);
    const stated = parseRetryAfter(response.headers.get("retry-after"));
    // A stated window, or a 429 whatever it stated: both are the provider
    // asking for room, and only these two are turned into a hold. A bare 503
    // is not — it is the generic "something is broken over here", and holding
    // a provider off for a minute over one would be reading a wish into it.
    const holdMs = stated ?? (response.status === 429 ? DEFAULT_RETRY_AFTER_MS : undefined);
    if (holdMs !== undefined) {
      throw new RetryAfterError(
        `${opts.label} for ${opts.providerId} failed: HTTP ${response.status} (retry after ${Math.round(holdMs / 1000)}s)`,
        holdMs,
      );
    }
    throw new Error(`${opts.label} for ${opts.providerId} failed: HTTP ${response.status}`);
  }

  const body = decode(await response.arrayBuffer(), response.headers.get("content-type"));
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (etag !== null || lastModified !== null) {
    remember(key, {
      etag: etag ?? undefined,
      lastModified: lastModified ?? undefined,
      body,
    });
  } else {
    // Nothing to revalidate with next time, and a stale entry would be offered
    // for a page that no longer supports conditional reads.
    cache.delete(key);
  }
  opts.onRead?.({ latencyMs, notModified: false });
  return body;
}
