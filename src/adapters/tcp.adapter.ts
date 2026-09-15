import { connect } from "node:net";
import type { Adapter, FetchContext, ReadingNote, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * A bare TCP connect — roadmap 1.9, the half of it the HTTP probe could not
 * absorb. Cert expiry already rides the request `http` makes (`tlsWarnDays`),
 * but a database, an SMTP relay or a message broker speaks no HTTP at all, so
 * there is no response for that adapter to read. What there is, is a handshake:
 * either the port accepted the connection or it did not.
 *
 * It inherits the probe's inverted contract, for the same reason (see
 * `http.adapter.ts`): a refused connection is this check's *answer*, not a
 * failed read, so the target's behaviour resolves into a severity and only our
 * own configuration throws.
 *
 * Deliberately narrow. It connects, measures how long that took, and hangs up
 * without sending a byte: a protocol handshake would mean knowing the protocol,
 * and every service worth probing speaks a different one. "The port is open" is
 * a smaller claim than "the service is healthy", and saying only the smaller one
 * is what keeps the reading honest.
 *
 * The target is the `baseUrl` the schema already validates — the host is taken
 * from it and the scheme ignored — with `port` naming the port when the URL
 * does not, since a URL's default port is a property of the scheme and this
 * check has none.
 */

/** The option keys this adapter reads, for the settings form and the docs. */
export const TCP_OPTION_KEYS = ["port", "slowMs"] as const;

export interface TcpProbeConfig {
  host: string;
  port: number;
  /** A connection that took at or over this long reads `degraded`. */
  slowMs?: number | undefined;
}

export type TcpOutcome =
  | { connected: true; latencyMs: number }
  | { connected: false; reason: string };

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

/**
 * The configuration to probe with, or a thrown error naming the option that is
 * wrong. Exported so the whole option surface can be exercised without a socket,
 * and so a caller that wants to validate a definition before saving it can do
 * so with one function call rather than its own copy of the rules.
 */
export function tcpConfig(service: ServiceRef): TcpProbeConfig {
  const options = service.options ?? {};

  let url: URL;
  try {
    url = new URL(service.baseUrl);
  } catch {
    throw new Error(`tcp probe for ${service.id}: baseUrl is not a URL`);
  }
  if (url.hostname === "") throw new Error(`tcp probe for ${service.id}: baseUrl names no host`);

  const port = parsePort(trimmed(options["port"]), url, service);
  return {
    host: url.hostname,
    port,
    slowMs: parseCount(trimmed(options["slowMs"]), service, "slowMs"),
  };
}

/**
 * The port option, the one in the URL, or the scheme's own — in that order. An
 * unusable value throws rather than falling back: a probe silently aimed at 443
 * because "5432" was mistyped would read healthy about the wrong thing.
 */
function parsePort(raw: string | undefined, url: URL, service: ServiceRef): number {
  const stated = raw ?? (url.port === "" ? undefined : url.port);
  if (stated === undefined) return url.protocol === "https:" ? 443 : 80;
  if (!/^\d+$/.test(stated)) {
    throw new Error(`tcp probe for ${service.id}: port "${stated}" is not a number`);
  }
  const port = Number(stated);
  if (port < 1 || port > 65_535) {
    throw new Error(`tcp probe for ${service.id}: port ${port} is outside 1-65535`);
  }
  return port;
}

function parseCount(raw: string | undefined, service: ServiceRef, key: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`tcp probe for ${service.id}: ${key} must be a positive whole number of milliseconds`);
  }
  return value;
}

/**
 * The severity an outcome reads as. Pure, and the whole decision: a port that
 * refused, reset or never answered is down; one that accepted slowly is
 * degraded; anything else is operational.
 *
 * `unknown` is never produced. It is the honest reading for a document we could
 * not make sense of, and a dishonest one here — whether the handshake completed
 * is the only question this check asks, and it always has an answer.
 */
export function severityFromOutcome(outcome: TcpOutcome, config: TcpProbeConfig): OverallStatus {
  if (!outcome.connected) return "major_outage";
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) return "degraded";
  return "operational";
}

/**
 * The sentence the reading cannot carry: why the probe is not operational.
 * Null when it is — a healthy check has nothing to explain, and a note on every
 * cycle would bury the ones that matter.
 */
export function noteFromOutcome(outcome: TcpOutcome, config: TcpProbeConfig): ReadingNote | null {
  const target = `${config.host}:${config.port}`;
  if (!outcome.connected) {
    return { text: `no answer from ${target}: ${outcome.reason}`, unreachable: true };
  }
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) {
    return {
      text: `connected to ${target} in ${outcome.latencyMs} ms, at or over the ${config.slowMs} ms threshold`,
    };
  }
  return null;
}

/** The reading an outcome produces, in the shape every other adapter returns. */
export function readingFromOutcome(
  service: ServiceRef,
  config: TcpProbeConfig,
  outcome: TcpOutcome,
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
 * One connect attempt, hung up as soon as it succeeds. Never rejects: every
 * way this can fail — refused, reset, unresolvable, too slow — is a reading,
 * and the reason travels with it because "down" and "down because the name
 * does not resolve" are two different afternoons.
 */
export function attemptConnect(config: TcpProbeConfig, timeoutMs: number): Promise<TcpOutcome> {
  return new Promise((resolve) => {
    const askedAt = Date.now();
    const socket = connect({ host: config.host, port: config.port });
    socket.setTimeout(timeoutMs);

    const settle = (outcome: TcpOutcome): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(outcome);
    };

    socket.once("connect", () => settle({ connected: true, latencyMs: Date.now() - askedAt }));
    socket.once("timeout", () => settle({ connected: false, reason: "timed out" }));
    socket.once("error", (error: Error) => settle({ connected: false, reason: error.message }));
  });
}

export const tcpAdapter: Adapter = {
  id: "tcp",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = tcpConfig(service);
    const outcome = await attemptConnect(config, ctx.timeoutMs);

    // A completed handshake is a read, and how long it took is worth recording
    // for the same reason a status page's latency is. A refused one measured
    // nothing, so it reports no read at all — only a note.
    if (outcome.connected) ctx.onRead?.({ latencyMs: outcome.latencyMs, notModified: false });

    const note = noteFromOutcome(outcome, config);
    if (note !== null) ctx.onNote?.(note);

    return readingFromOutcome(service, config, outcome);
  },
};
