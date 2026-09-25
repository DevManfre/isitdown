import { stringify } from "yaml";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../core/logger.ts";
import type { ServiceDefinition } from "../core/configSource.interface.ts";
import type { ServiceRef } from "../core/adapter.interface.ts";
import { parseStatusSpec } from "../adapters/http.adapter.ts";
import { tcpConfig } from "../adapters/tcp.adapter.ts";
import { dnsConfig } from "../adapters/dns.adapter.ts";
import { listServices, readSettings } from "./dbConfigSource.ts";

/**
 * The fleet as a Gatus `config.yaml` (roadmap 17.4) — a downloadable second
 * opinion for an operator who wants to try, or move to, a neighbour.
 *
 * Gatus has no notion of a status page: it has endpoints it checks itself. So
 * this only ever translates a *probe* (`http`, `tcp`, `dns`) — the one thing
 * both tools genuinely do the same way — and counts everything else in the
 * header rather than inventing an HTTP check against a status-page URL that
 * would not mean what Gatus users expect an endpoint to mean.
 *
 * A DNS probe left on the system resolver is skipped for the same reason: a
 * Gatus DNS endpoint's `url` names the server to query, and "whatever
 * /etc/resolv.conf happens to be" is not a server this file can name honestly.
 *
 * Pure and offline, like `configFile.ts`'s export: no Express, no network, the
 * same `${VAR}` references the dashboard already stores rather than a
 * resolved secret. Probe options never carry a header credential into this
 * file — headers are not translated at all (see `httpEndpoint`), which side-
 * steps the question rather than leaving it to a reviewer to notice.
 */

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

function parsePositiveInt(value: string | undefined): number | undefined {
  const text = trimmed(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * `[STATUS]` conditions for the ranges `expectStatus` declared. Gatus
 * conditions are AND-only, so only the two shapes an AND-chain can actually
 * express are translated: one range (as a bound, or as `==` for a single
 * code) and several exact codes (as `any(...)`). Anything wider than that —
 * mixed ranges and exact codes together — has no honest single-condition
 * translation, so it falls back to the loosest true statement about an HTTP
 * status rather than a narrower one nobody asked for.
 */
function statusConditions(ranges: [number, number][]): string[] {
  if (ranges.length === 1) {
    const [from, to] = ranges[0]!;
    return from === to ? [`[STATUS] == ${from}`] : [`[STATUS] >= ${from}`, `[STATUS] <= ${to}`];
  }
  if (ranges.every(([from, to]) => from === to)) {
    return [`[STATUS] == any(${ranges.map(([from]) => from).join(", ")})`];
  }
  return [`[STATUS] >= 100`];
}

interface MappedEndpoint {
  name: string;
  group: string | undefined;
  url: string;
  conditions: string[];
  dns?: { "query-name": string; "query-type": string };
}

function httpEndpoint(service: ServiceRef & { group?: string | undefined }): MappedEndpoint {
  const options = service.options ?? {};
  const path = trimmed(options["path"]) ?? "";

  const conditions = statusConditions(parseStatusSpec(trimmed(options["expectStatus"]) ?? "200-299", service));

  const expectBody = trimmed(options["expectBody"]);
  if (expectBody !== undefined) conditions.push(`[BODY] == pat(*${expectBody}*)`);
  const absentBody = trimmed(options["absentBody"]);
  if (absentBody !== undefined) conditions.push(`[BODY] != pat(*${absentBody}*)`);

  const slowMs = parsePositiveInt(options["slowMs"]);
  if (slowMs !== undefined) conditions.push(`[RESPONSE_TIME] < ${slowMs}`);

  const tlsWarnDays = parsePositiveInt(options["tlsWarnDays"]);
  if (tlsWarnDays !== undefined) conditions.push(`[CERTIFICATE_EXPIRATION] > ${tlsWarnDays * 24}h`);

  return { name: service.name, group: service.group, url: `${service.baseUrl}${path}`, conditions };
}

function tcpEndpoint(service: ServiceRef & { group?: string | undefined }): MappedEndpoint {
  const config = tcpConfig(service);
  const conditions = ["[CONNECTED] == true"];
  if (config.slowMs !== undefined) conditions.push(`[RESPONSE_TIME] < ${config.slowMs}`);
  return { name: service.name, group: service.group, url: `tcp://${config.host}:${config.port}`, conditions };
}

/** Null when the probe has no explicit resolver — see the module note on why that is left out rather than guessed. */
function dnsEndpoint(service: ServiceRef & { group?: string | undefined }): MappedEndpoint | null {
  const config = dnsConfig(service);
  if (config.resolver === undefined) return null;

  const conditions = ["[DNS_RCODE] == NOERROR"];
  if (config.expectValue !== undefined) conditions.push(`[BODY] == pat(*${config.expectValue}*)`);
  if (config.slowMs !== undefined) conditions.push(`[RESPONSE_TIME] < ${config.slowMs}`);

  return {
    name: service.name,
    group: service.group,
    url: config.resolver,
    conditions,
    dns: { "query-name": config.name, "query-type": config.recordType },
  };
}

interface SkipCounts {
  /** Adapter id -> how many services of it were skipped, no Gatus equivalent. */
  byAdapter: Map<string, number>;
  /** A dns probe left on the system resolver, with no server this file can name. */
  dnsNoResolver: number;
  /** Options that failed to parse the way the poller itself would refuse to run them. */
  unparsable: number;
}

const PROBE_MAPPERS: Record<string, (service: ServiceDefinition) => MappedEndpoint | null> = {
  http: httpEndpoint,
  tcp: tcpEndpoint,
  dns: dnsEndpoint,
};

export function exportGatusYaml(db: DatabaseSync, logger: Logger): string {
  const settings = readSettings(db, logger);
  const services = listServices(db);

  const endpoints: Record<string, unknown>[] = [];
  const skipped: SkipCounts = { byAdapter: new Map(), dnsNoResolver: 0, unparsable: 0 };

  for (const service of services) {
    const mapper = PROBE_MAPPERS[service.adapter];
    if (mapper === undefined) {
      skipped.byAdapter.set(service.adapter, (skipped.byAdapter.get(service.adapter) ?? 0) + 1);
      continue;
    }

    let mapped: MappedEndpoint | null;
    try {
      mapped = mapper(service);
    } catch (error) {
      skipped.unparsable += 1;
      logger.warn("gatus export: a service's options could not be translated", {
        service: service.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (mapped === null) {
      skipped.dnsNoResolver += 1;
      continue;
    }

    const intervalMinutes = service.intervalMinutes ?? settings.pollIntervalMinutes;
    endpoints.push({
      name: mapped.name,
      ...(mapped.group === undefined ? {} : { group: mapped.group }),
      url: mapped.url,
      interval: `${intervalMinutes}m`,
      ...(service.enabled ? {} : { enabled: false }),
      ...(mapped.dns === undefined ? {} : { dns: mapped.dns }),
      conditions: mapped.conditions,
    });
  }

  return `${gatusHeader(services.length, endpoints.length, skipped)}${stringify({ endpoints }, { lineWidth: 0 })}`;
}

function gatusHeader(total: number, mapped: number, skipped: SkipCounts): string {
  const lines = [
    "# IsItDown fleet, exported as a Gatus config.yaml endpoint list (see README roadmap 17.4).",
    "#",
    "# Only http/tcp/dns probes have a Gatus equivalent — a status page is a document",
    "# to read, and Gatus checks endpoints it reaches itself, so a status-page-based",
    "# provider is counted below rather than turned into a check against its status",
    "# page pretending to be the thing it watches.",
    "#",
    `# ${mapped} of ${total} service(s) translated. A disabled provider is included`,
    "# with `enabled: false`, the way Gatus itself represents one; a removed",
    "# (soft-deleted) provider is not part of the running fleet and is not included.",
  ];

  const statusPageAdapters = [...skipped.byAdapter.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (statusPageAdapters.length > 0) {
    lines.push("#", "# Skipped, no Gatus equivalent:");
    for (const [adapter, count] of statusPageAdapters) {
      lines.push(`#   - ${adapter}: ${count} service(s)`);
    }
  }
  if (skipped.dnsNoResolver > 0) {
    lines.push(
      "#",
      `# Skipped: ${skipped.dnsNoResolver} dns probe(s) with no explicit resolver — Gatus needs a server`,
      "# address to query, and the system resolver this probe otherwise reads has none.",
    );
  }
  if (skipped.unparsable > 0) {
    lines.push(
      "#",
      `# Skipped: ${skipped.unparsable} service(s) whose options could not be translated (see the server log).`,
    );
  }

  return `${lines.join("\n")}\n`;
}
