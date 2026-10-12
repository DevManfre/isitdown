import { execFile } from "node:child_process";
import type { Adapter, FetchContext, ReadingNote, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * An ICMP echo — roadmap 2.6, the homelab's oldest question: does the box
 * answer at all. A router, a printer, a NAS with no HTTP worth probing.
 *
 * Node has no raw socket, so this runs the system's own `ping` rather than
 * carrying a native module: busybox's in the Alpine image, iputils' on a Linux
 * host. Neither needs root inside a container — Docker allows unprivileged ICMP
 * sockets by default (`net.ipv4.ping_group_range`) — and a host without a
 * `ping` binary at all says so in the reading's note rather than going quiet.
 *
 * The probe's inverted contract holds (see `http.adapter.ts`): no reply, an
 * unknown host, a lost packet are this check's *answers*, so they resolve into
 * a severity; only our own configuration throws.
 *
 * The host is `baseUrl`'s, as for the `tcp` probe — scheme, port and path are
 * ignored.
 */

/** The option keys this adapter reads, for the settings form and the docs. */
export const ICMP_OPTION_KEYS = ["count", "slowMs"] as const;

const DEFAULT_COUNT = 3;
const MAX_COUNT = 10;

export interface IcmpProbeConfig {
  host: string;
  /** Echo requests per reading. More than one, so one dropped packet is a loss rate, not an outage. */
  count: number;
  /** An average round trip at or over this reads `degraded`. */
  slowMs?: number | undefined;
}

export type IcmpOutcome =
  | { replied: true; sent: number; received: number; avgMs: number | undefined }
  | { replied: false; reason: string };

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

function parseCount(raw: string | undefined, service: ServiceRef, key: string, max?: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || (max !== undefined && value > max)) {
    throw new Error(
      `icmp probe for ${service.id}: ${key} must be a positive whole number${max === undefined ? "" : ` up to ${max}`}`,
    );
  }
  return value;
}

/**
 * The configuration this service probes with, or a thrown error naming the
 * option that is wrong. Exported so the option surface can be exercised without
 * spawning anything.
 */
export function icmpConfig(service: ServiceRef): IcmpProbeConfig {
  const options = service.options ?? {};
  let url: URL;
  try {
    url = new URL(service.baseUrl);
  } catch {
    throw new Error(`icmp probe for ${service.id}: baseUrl is not a URL`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "") throw new Error(`icmp probe for ${service.id}: baseUrl names no host`);
  // `ping` reads a leading dash as an option; a host never starts with one.
  if (host.startsWith("-")) throw new Error(`icmp probe for ${service.id}: host ${host} is not a host name`);
  return {
    host,
    count: parseCount(trimmed(options["count"]), service, "count", MAX_COUNT) ?? DEFAULT_COUNT,
    slowMs: parseCount(trimmed(options["slowMs"]), service, "slowMs"),
  };
}

/**
 * The summary both `ping`s print, busybox's and iputils': "3 packets
 * transmitted, 2 received" (busybox says "2 packets received") and a
 * "min/avg/max" round-trip line. Null when there is no summary at all — the
 * host did not resolve, or the binary refused to run.
 */
export function parsePingOutput(output: string): { sent: number; received: number; avgMs: number | undefined } | null {
  const counts = /(\d+) packets transmitted, (\d+) (?:packets )?received/.exec(output);
  if (counts === null) return null;
  const average = /(?:rtt|round-trip) min\/avg\/max(?:\/mdev)? = [\d.]+\/([\d.]+)\//.exec(output)?.[1];
  return {
    sent: Number(counts[1]),
    received: Number(counts[2]),
    avgMs: average === undefined ? undefined : Number(average),
  };
}

/**
 * The severity an outcome reads as: nothing back is down, some loss is a partial
 * outage — the link is there but not whole — a slow average is degraded.
 */
export function severityFromOutcome(outcome: IcmpOutcome, config: IcmpProbeConfig): OverallStatus {
  if (!outcome.replied || outcome.received === 0) return "major_outage";
  if (outcome.received < outcome.sent) return "partial_outage";
  if (config.slowMs !== undefined && outcome.avgMs !== undefined && outcome.avgMs >= config.slowMs) return "degraded";
  return "operational";
}

/** Why the reading is not operational, or null when it is. */
export function noteFromOutcome(outcome: IcmpOutcome, config: IcmpProbeConfig): ReadingNote | null {
  if (!outcome.replied) return { text: `no ping to ${config.host}: ${outcome.reason}`, unreachable: true };
  if (outcome.received === 0) {
    return { text: `${config.host} answered none of ${outcome.sent} echo requests`, unreachable: true };
  }
  if (outcome.received < outcome.sent) {
    return { text: `${config.host} answered ${outcome.received} of ${outcome.sent} echo requests` };
  }
  if (config.slowMs !== undefined && outcome.avgMs !== undefined && outcome.avgMs >= config.slowMs) {
    return { text: `${config.host} answered in ${Math.round(outcome.avgMs)} ms on average, at or over ${config.slowMs} ms` };
  }
  return null;
}

/**
 * One run of `ping`. Never rejects: whatever happened becomes an outcome. Each
 * reply is waited for as long as the request timeout allows, and the whole run
 * is killed if it outlives every reply's wait plus the one-second gaps between
 * them.
 */
export function attemptPing(config: IcmpProbeConfig, timeoutMs: number): Promise<IcmpOutcome> {
  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return new Promise((resolve) => {
    execFile(
      "ping",
      ["-c", String(config.count), "-W", String(waitSeconds), config.host],
      { timeout: (config.count - 1) * 1000 + waitSeconds * 1000 + 2000, encoding: "utf8" },
      (error, stdout, stderr) => {
        const summary = parsePingOutput(stdout);
        if (summary !== null) {
          resolve({ replied: true, ...summary });
          return;
        }
        const code = (error as NodeJS.ErrnoException | null)?.code;
        const reason =
          code === "ENOENT"
            ? "no ping binary on this host"
            : (stderr.trim().split("\n").pop() ?? "") || (error?.message ?? "ping printed no summary");
        resolve({ replied: false, reason });
      },
    );
  });
}

export const icmpAdapter: Adapter = {
  id: "icmp",
  version: 1,
  kind: "probe",

  validateOptions(options) {
    try {
      icmpConfig({ id: "icmp", name: "icmp", baseUrl: "http://localhost", options });
      return [];
    } catch (error) {
      return [error instanceof Error ? error.message.replace(/^icmp probe for icmp: /, "") : String(error)];
    }
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = icmpConfig(service);
    const outcome = await attemptPing(config, ctx.timeoutMs);

    if (outcome.replied && outcome.avgMs !== undefined) ctx.onRead?.({ latencyMs: outcome.avgMs, notModified: false });
    const note = noteFromOutcome(outcome, config);
    if (note !== null) ctx.onNote?.(note);

    return {
      provider: service.id,
      overallStatus: severityFromOutcome(outcome, config),
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    };
  },
};
