import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * The probe: the one adapter whose subject is a service itself rather than a
 * page a provider publishes about it (roadmap 1.8).
 *
 * Every other adapter here reads a document, and that difference inverts two
 * rules the rest of the folder takes for granted:
 *
 * - a non-2xx answer is a *reading*, not a failed read. A status page that
 *   answers 503 has told us nothing about its provider, so it throws and the
 *   poller retries; an endpoint we probe that answers 503 has told us the thing
 *   is down, which is the entire reason the check exists;
 * - a refused connection, a DNS failure or a timeout says the same thing. For a
 *   status page those mean "we have gone blind"; here they mean "your service
 *   did not answer", which is precisely what the operator asked to hear about.
 *
 * So the target's behaviour never throws — it resolves into a severity. What
 * does throw is *our* configuration: an unparseable `expectStatus`, a `${VAR}`
 * header with nothing behind it, an `expectBody` on a `HEAD` that downloads no
 * body. Those are ours to fix, and a check quietly reading "down" because its
 * own options are wrong is worse than one that fails loudly.
 *
 * Two things to be honest about, both deliberate:
 *
 * - the reading comes from one vantage point, this container. A local DNS or
 *   egress failure reads as every probed target being down at once. Flap
 *   damping (`confirmSamples`) blunts a blip; telling a fleet-wide network
 *   failure of our own apart from a real one is not something this file
 *   pretends to do.
 * - the reading is a severity and nothing more — no incidents, no components,
 *   no maintenance windows. There is no document to read them out of, and
 *   minting an incident per poll would open and resolve one every cycle. "Down
 *   since 14:03" already comes out of the status change and the history.
 */

/** Only the two methods a poller may safely repeat. */
const METHODS = ["GET", "HEAD"] as const;

type ProbeMethod = (typeof METHODS)[number];

/** Anything 2xx, when the operator states nothing. */
const DEFAULT_STATUS_SPEC = "200-299";

/**
 * A probe asks for whatever the endpoint serves: it is checking that the thing
 * answers, not that it answers in one format.
 */
const ACCEPT = "*/*";

/** Inclusive, and single statuses are stored as a range of one. */
type StatusRange = [number, number];

export interface ProbeConfig {
  method: ProbeMethod;
  /** The full url probed: `baseUrl` plus the optional `path` option. */
  url: string;
  accepted: StatusRange[];
  followRedirects: boolean;
  expectBody?: string | undefined;
  absentBody?: string | undefined;
  /** An answer at or over this reads `degraded` rather than `operational`. */
  slowMs?: number | undefined;
  headers: Record<string, string>;
}

/** The option keys this adapter reads, for the settings form and the docs. */
export const PROBE_OPTION_KEYS = [
  "method",
  "path",
  "expectStatus",
  "expectBody",
  "absentBody",
  "slowMs",
  "followRedirects",
] as const;

/** Prefix of an option carrying a request header, e.g. `header.Authorization`. */
export const PROBE_HEADER_PREFIX = "header.";

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

/**
 * Resolves `${VAR}` against the environment, the way every credential in this
 * project travels. An unset variable throws rather than sending the literal
 * `${VAR}` as a bearer token — the endpoint would answer 401 and the probe
 * would report the service down, which is the wrong thing to wake up to.
 */
function resolveEnv(value: string, service: ServiceRef, key: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const found = process.env[name];
    if (found === undefined || found === "") {
      throw new Error(`http probe for ${service.id}: ${key} references ${name}, which is not set`);
    }
    return found;
  });
}

/**
 * `"200"`, `"200-299"`, `"200-299,301,302"`. Worth its own parser rather than a
 * loose "is it 2xx" test: an endpoint whose healthy answer is a 302 to a login
 * page, or a 401 from an API that is up and simply refusing us, are both real
 * and both unrepresentable otherwise.
 */
export function parseStatusSpec(spec: string, service: ServiceRef): StatusRange[] {
  const ranges = spec
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part): StatusRange => {
      const match = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(part);
      if (match === null) {
        throw new Error(`http probe for ${service.id}: expectStatus has an unreadable part "${part}"`);
      }
      const from = Number(match[1]);
      const to = match[2] === undefined ? from : Number(match[2]);
      if (to < from) {
        throw new Error(`http probe for ${service.id}: expectStatus range "${part}" ends before it starts`);
      }
      return [from, to];
    });
  if (ranges.length === 0) {
    throw new Error(`http probe for ${service.id}: expectStatus is empty`);
  }
  return ranges;
}

function parseMethod(raw: string | undefined, service: ServiceRef): ProbeMethod {
  if (raw === undefined) return "GET";
  const method = raw.toUpperCase();
  // POST is deliberately absent: the poller retries a failed read, and retrying
  // a POST is the one thing a monitoring tool must never do on its own.
  if (!METHODS.includes(method as ProbeMethod)) {
    throw new Error(`http probe for ${service.id}: method ${raw} is not one of ${METHODS.join(", ")}`);
  }
  return method as ProbeMethod;
}

function parseFlag(raw: string | undefined, fallback: boolean, service: ServiceRef, key: string): boolean {
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (["yes", "true", "1", "on"].includes(value)) return true;
  if (["no", "false", "0", "off"].includes(value)) return false;
  throw new Error(`http probe for ${service.id}: ${key} must be yes or no, not "${raw}"`);
}

function parseSlowMs(raw: string | undefined, service: ServiceRef): number | undefined {
  if (raw === undefined) return undefined;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(`http probe for ${service.id}: slowMs must be a positive whole number of milliseconds`);
  }
  return ms;
}

/**
 * The configuration this service probes with, or a thrown error naming the
 * option that is wrong. Exported so the whole option surface is exercised
 * without a socket, and so a caller that wants to validate a definition before
 * saving it has one function to call rather than its own copy of these rules.
 */
export function probeConfig(service: ServiceRef): ProbeConfig {
  const options = service.options ?? {};
  const method = parseMethod(trimmed(options["method"]), service);
  const expectBody = trimmed(options["expectBody"]);
  const absentBody = trimmed(options["absentBody"]);

  if (method === "HEAD" && (expectBody !== undefined || absentBody !== undefined)) {
    throw new Error(`http probe for ${service.id}: a HEAD request downloads no body to match against`);
  }

  const headers: Record<string, string> = { accept: ACCEPT };
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(PROBE_HEADER_PREFIX)) continue;
    const name = key.slice(PROBE_HEADER_PREFIX.length).trim();
    if (name === "") throw new Error(`http probe for ${service.id}: an option named "${key}" has no header name`);
    headers[name] = resolveEnv(value, service, key);
  }

  // The config schema strips a trailing slash from every base url, because the
  // adapters that append a path would otherwise double it up. `path` is how a
  // probe says the slash mattered — and how one host can be probed at two
  // paths from two service definitions.
  const path = options["path"]?.trim() ?? "";

  return {
    method,
    url: `${service.baseUrl}${path}`,
    accepted: parseStatusSpec(trimmed(options["expectStatus"]) ?? DEFAULT_STATUS_SPEC, service),
    followRedirects: parseFlag(trimmed(options["followRedirects"]), true, service, "followRedirects"),
    expectBody,
    absentBody,
    slowMs: parseSlowMs(trimmed(options["slowMs"]), service),
    headers,
  };
}

/** Whether the check needs the body at all; a probe that does not skips the download. */
export const readsBody = (config: ProbeConfig): boolean =>
  config.expectBody !== undefined || config.absentBody !== undefined;

/** What came back, or the fact that nothing did. */
export type ProbeOutcome =
  | { answered: true; status: number; body: string | null; latencyMs: number }
  | { answered: false };

/**
 * The severity an outcome reads as. Pure, and the whole decision: an endpoint
 * that did not answer, answered outside the accepted statuses, or answered with
 * the wrong body is down; one that answered correctly but slowly is degraded;
 * anything else is operational.
 *
 * `unknown` is never produced here. It is the honest reading for a status page
 * whose document we could not make sense of, and the dishonest one for a probe:
 * an endpoint that refuses a connection has answered the only question this
 * check asks.
 */
export function severityFromOutcome(outcome: ProbeOutcome, config: ProbeConfig): OverallStatus {
  if (!outcome.answered) return "major_outage";

  const accepted = config.accepted.some(([from, to]) => outcome.status >= from && outcome.status <= to);
  if (!accepted) return "major_outage";

  const body = outcome.body ?? "";
  if (config.expectBody !== undefined && !body.includes(config.expectBody)) return "major_outage";
  if (config.absentBody !== undefined && body.includes(config.absentBody)) return "major_outage";

  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) return "degraded";
  return "operational";
}

/** The reading an outcome produces, in the shape every other adapter returns. */
export function readingFromOutcome(
  service: ServiceRef,
  config: ProbeConfig,
  outcome: ProbeOutcome,
): NormalizedStatus {
  return {
    provider: service.id,
    overallStatus: severityFromOutcome(outcome, config),
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

export const httpAdapter: Adapter = {
  id: "http",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = probeConfig(service);

    let response: Response;
    const askedAt = Date.now();
    try {
      response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        // A probe wants the current answer: a cache replaying a 200 would
        // report a dead endpoint as healthy.
        cache: "no-store",
        redirect: config.followRedirects ? "follow" : "manual",
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
    } catch {
      // Refused, unresolvable, TLS rejected, or past the timeout. All four are
      // the endpoint failing to answer, which is a reading — and none of them
      // is a latency worth recording, so nothing is reported to `onRead`.
      return readingFromOutcome(service, config, { answered: false });
    }

    // To the headers, like every other read here: `fetch` resolves on them, and
    // including the download would make a small answer look faster than a large
    // one for reasons that say nothing about the service's health.
    const latencyMs = Date.now() - askedAt;

    let body: string | null = null;
    if (readsBody(config)) {
      try {
        body = await response.text();
      } catch {
        // The headers arrived and the body did not. The endpoint answered, but
        // not with the content the check was told to look for.
        body = "";
      }
    } else {
      // Nothing to match against, so the bytes are not downloaded at all — the
      // socket is released rather than left holding a body nobody reads.
      await response.body?.cancel().catch(() => undefined);
    }

    ctx.onRead?.({ latencyMs, notModified: false });
    return readingFromOutcome(service, config, {
      answered: true,
      status: response.status,
      body,
      latencyMs,
    });
  },
};
