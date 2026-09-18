import { Resolver } from "node:dns/promises";
import type { Adapter, FetchContext, ReadingNote, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * A DNS resolution — roadmap 1.9, the other half the HTTP probe could not
 * absorb. Every other check here needs a name to already resolve before it can
 * say anything; this one is about the resolution itself, which is the outage
 * nobody notices until every other check goes red at once.
 *
 * It inherits the probe's inverted contract, for the same reason (see
 * `http.adapter.ts`): NXDOMAIN, an empty answer or a resolver that never
 * replies are this check's *answers*, so they resolve into a severity, and only
 * our own configuration throws.
 *
 * The name comes from the `baseUrl` the schema already validates — its host,
 * with the scheme and path ignored. `resolver` aims the question at a specific
 * server, which is what makes it possible to watch an authoritative server
 * directly rather than whatever the container's `/etc/resolv.conf` happens to
 * cache; unset, the system resolver answers, which is the reading that matches
 * what the rest of the fleet experiences.
 *
 * `expectValue` is what turns "it answered" into "it answered correctly": a
 * record pointed at a decommissioned address still resolves, and that is a
 * different kind of bad day from not resolving at all.
 */

/** The option keys this adapter reads, for the settings form and the docs. */
export const DNS_OPTION_KEYS = ["recordType", "expectValue", "resolver", "slowMs"] as const;

/** What can be asked for. Each maps onto one `Resolver` method below. */
const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"] as const;
export type DnsRecordType = (typeof RECORD_TYPES)[number];

export interface DnsProbeConfig {
  name: string;
  recordType: DnsRecordType;
  /** Must appear in one of the answers, or the reading is an outage. */
  expectValue?: string | undefined;
  /** `1.1.1.1`, or `127.0.0.1:5353` — the form `Resolver.setServers` takes. */
  resolver?: string | undefined;
  /** An answer at or over this long reads `degraded` rather than `operational`. */
  slowMs?: number | undefined;
}

export type DnsOutcome =
  | { answered: true; values: string[]; latencyMs: number }
  | { answered: false; reason: string };

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

/**
 * The configuration to resolve with, or a thrown error naming the option that
 * is wrong. Exported so the whole option surface can be exercised without a
 * socket, and so a caller that wants to validate a definition before saving it
 * can do so with one function call rather than its own copy of the rules.
 */
export function dnsConfig(service: ServiceRef): DnsProbeConfig {
  const options = service.options ?? {};

  let url: URL;
  try {
    url = new URL(service.baseUrl);
  } catch {
    throw new Error(`dns probe for ${service.id}: baseUrl is not a URL`);
  }
  if (url.hostname === "") throw new Error(`dns probe for ${service.id}: baseUrl names no host`);

  return {
    // Bracketed IPv6 literals come back from `URL` with the brackets; a name is
    // what gets asked about, so they are stripped rather than passed along.
    name: url.hostname.replace(/^\[|\]$/g, ""),
    recordType: parseRecordType(trimmed(options["recordType"]), service),
    expectValue: trimmed(options["expectValue"]),
    resolver: trimmed(options["resolver"]),
    slowMs: parseCount(trimmed(options["slowMs"]), service, "slowMs"),
  };
}

function parseRecordType(raw: string | undefined, service: ServiceRef): DnsRecordType {
  if (raw === undefined) return "A";
  const type = raw.toUpperCase();
  if (!RECORD_TYPES.includes(type as DnsRecordType)) {
    throw new Error(
      `dns probe for ${service.id}: recordType ${raw} is not one of ${RECORD_TYPES.join(", ")}`,
    );
  }
  return type as DnsRecordType;
}

function parseCount(raw: string | undefined, service: ServiceRef, key: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `dns probe for ${service.id}: ${key} must be a positive whole number of milliseconds`,
    );
  }
  return value;
}

/**
 * The severity an outcome reads as. Pure, and the whole decision: a name that
 * did not resolve, resolved to nothing, or resolved to something other than
 * what was expected is down; a slow answer is degraded; anything else is
 * operational.
 *
 * An empty answer counts as an outage rather than as a missing field. Every
 * other adapter degrades on one, because a provider dropping a field is not an
 * outage of ours — but here the answer *is* the reading, and a `NOANSWER` for
 * the record a service is reached by means nobody can reach it.
 */
export function severityFromOutcome(outcome: DnsOutcome, config: DnsProbeConfig): OverallStatus {
  if (!outcome.answered) return "major_outage";
  if (outcome.values.length === 0) return "major_outage";
  if (config.expectValue !== undefined && !outcome.values.some((value) => value.includes(config.expectValue!))) {
    return "major_outage";
  }
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) return "degraded";
  return "operational";
}

/**
 * The sentence the reading cannot carry: why the probe is not operational.
 * Null when it is — a healthy check has nothing to explain, and a note on every
 * cycle would bury the ones that matter.
 */
export function noteFromOutcome(outcome: DnsOutcome, config: DnsProbeConfig): ReadingNote | null {
  const asked = `${config.recordType} ${config.name}`;
  if (!outcome.answered) {
    return { text: `no answer for ${asked}: ${outcome.reason}`, unreachable: true };
  }
  if (outcome.values.length === 0) {
    return { text: `${asked} resolved to no records at all`, unreachable: true };
  }
  if (config.expectValue !== undefined && !outcome.values.some((value) => value.includes(config.expectValue!))) {
    return {
      text: `${asked} resolved to ${outcome.values.join(", ")}, without the expected "${config.expectValue}"`,
    };
  }
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) {
    return {
      text: `${asked} answered in ${outcome.latencyMs} ms, at or over the ${config.slowMs} ms threshold`,
    };
  }
  return null;
}

/** The reading an outcome produces, in the shape every other adapter returns. */
export function readingFromOutcome(
  service: ServiceRef,
  config: DnsProbeConfig,
  outcome: DnsOutcome,
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

/**
 * Every record type flattened to the same thing: a list of strings, each
 * carrying everything about one answer that is worth matching `expectValue`
 * against. An MX keeps its preference and a TXT its chunks joined, because
 * both are how those records are written down when someone says what they
 * should be.
 */
async function askFor(resolver: Resolver, config: DnsProbeConfig): Promise<string[]> {
  switch (config.recordType) {
    case "A":
      return await resolver.resolve4(config.name);
    case "AAAA":
      return await resolver.resolve6(config.name);
    case "CNAME":
      return await resolver.resolveCname(config.name);
    case "NS":
      return await resolver.resolveNs(config.name);
    case "MX":
      return (await resolver.resolveMx(config.name)).map(
        (record) => `${record.priority} ${record.exchange}`,
      );
    case "TXT":
      return (await resolver.resolveTxt(config.name)).map((chunks) => chunks.join(""));
  }
}

/**
 * One resolution. Never rejects: NXDOMAIN, an empty answer and a resolver that
 * never replies are all readings, and node's own code (`ENOTFOUND`,
 * `ETIMEOUT`, `SERVFAIL`) is the reason worth carrying — it is the difference
 * between "this name is gone" and "our resolver is".
 */
export async function attemptResolve(config: DnsProbeConfig, timeoutMs: number): Promise<DnsOutcome> {
  // `tries: 1` because the poller already retries: a resolver library quietly
  // trying three times inside one attempt would multiply the deadline the
  // caller set by three.
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (config.resolver !== undefined) {
    try {
      resolver.setServers([config.resolver]);
    } catch {
      // Ours to fix, not the name's fault: an unusable server address would
      // otherwise read as an outage of whatever it was pointed at.
      throw new Error(`dns probe: resolver "${config.resolver}" is not an address`);
    }
  }

  const askedAt = Date.now();
  try {
    return { answered: true, values: await askFor(resolver, config), latencyMs: Date.now() - askedAt };
  } catch (error) {
    return { answered: false, reason: resolutionReason(error) };
  }
}

/**
 * What to call a failed resolution. Node puts the useful word in `code`
 * (`ENOTFOUND`, `ENODATA`, `ETIMEOUT`, `SERVFAIL`) and repeats it inside a
 * message that also names the syscall, so the code alone reads better in a
 * note.
 */
export function resolutionReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return code === undefined || code === "" ? error.message : code;
}

export const dnsAdapter: Adapter = {
  id: "dns",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = dnsConfig(service);
    const outcome = await attemptResolve(config, ctx.timeoutMs);

    // An answer is a read, and how long it took is worth recording for the same
    // reason a status page's latency is. A failed resolution measured nothing,
    // so it reports no read at all — only a note.
    if (outcome.answered) ctx.onRead?.({ latencyMs: outcome.latencyMs, notModified: false });

    const note = noteFromOutcome(outcome, config);
    if (note !== null) ctx.onNote?.(note);

    return readingFromOutcome(service, config, outcome);
  },
};
