import { parse as parseYaml } from "yaml";
import { z, ZodError } from "zod";
import { MIN_INTERVAL_SECONDS, serviceDefinitionSchema } from "../../core/config.schema.ts";
import { HEARTBEAT_ADAPTER_ID, HEARTBEAT_BASE_URL, heartbeatConfig } from "../../core/heartbeat.ts";
import type { CatalogEntry } from "../catalog.ts";
import { dnsConfig } from "../dns.adapter.ts";
import { probeConfig } from "../http.adapter.ts";
import { tcpConfig } from "../tcp.adapter.ts";
import type { Candidate, ImportNote, ImportTool, SkipReason, Target } from "./candidate.ts";
import { parseGatus } from "./gatus.ts";
import { parseStatping } from "./statping.ts";
import { parseStatusGator } from "./statusgator.ts";
import { parseUptimeKuma } from "./uptimekuma.ts";

export type { ImportNote, ImportNoteCode, ImportTool, SkipReason } from "./candidate.ts";

/**
 * Importing a fleet from a neighbour tool — roadmap 2.4.
 *
 * Whoever arrives already has a list of things they watch, in somebody else's
 * format. This turns that list into providers and says how it went: these
 * monitors become probes, these are status pages the catalog recognises, these
 * are jobs that call in, and these have no equivalent and why.
 *
 * Pure, like discovery (roadmap 2.3): a file in, a proposal out. Nothing is
 * fetched and nothing is written — reading the file is the CLI's job, adding a
 * provider is the operator's. Every proposal has been through the same schema
 * and option checks a save goes through, so a proposal is one the dashboard
 * and `config.yml` will both accept.
 */

export const IMPORT_TOOLS: readonly ImportTool[] = ["uptimekuma", "gatus", "statping", "statusgator"];

type ServiceInput = z.input<typeof serviceDefinitionSchema>;

export interface ImportedService {
  /** The monitor's name in the neighbour tool. */
  source: string;
  /** The neighbour's word for what it was. */
  type: string;
  kind: "probe" | "page" | "heartbeat";
  service: ServiceInput;
  notes: ImportNote[];
}

export interface SkippedMonitor {
  source: string;
  type: string;
  reason: SkipReason;
  detail?: string | undefined;
}

export interface ImportResult {
  tool: ImportTool;
  services: ImportedService[];
  skipped: SkippedMonitor[];
}

const PARSERS: Record<ImportTool, (content: string) => Candidate[]> = {
  uptimekuma: parseUptimeKuma,
  gatus: parseGatus,
  statping: parseStatping,
  statusgator: parseStatusGator,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Which tool wrote a file, from its shape alone; null when it is none of them. */
export function detectImportTool(content: string): ImportTool | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    json = undefined;
  }
  if (isRecord(json)) {
    if (Array.isArray(json["monitorList"])) return "uptimekuma";
    if (Array.isArray(json["services"])) return "statping";
    if (Array.isArray(json["data"])) return "statusgator";
    return null;
  }
  if (Array.isArray(json)) return json.some((item) => isRecord(item) && "monitor_type" in item) ? "statusgator" : null;

  let yaml: unknown;
  try {
    yaml = parseYaml(content);
  } catch {
    return null;
  }
  return isRecord(yaml) && ("endpoints" in yaml || "external-endpoints" in yaml) ? "gatus" : null;
}

/** `Mail server (EU)` → `mail-server-eu`; the slug a provider id must be. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? "monitor" : slug;
}

const hostKey = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/** The neighbour's cadence in the units a probe takes, and what had to give. */
function probeCadence(seconds: number | undefined): {
  cadence: Pick<ServiceInput, "intervalMinutes" | "intervalSeconds">;
  note?: ImportNote;
} {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return { cadence: {} };
  if (seconds < MIN_INTERVAL_SECONDS) {
    return {
      cadence: { intervalSeconds: MIN_INTERVAL_SECONDS },
      note: { code: "cadence-raised", detail: `${seconds}s → ${MIN_INTERVAL_SECONDS}s` },
    };
  }
  if (seconds % 60 !== 0 && seconds <= 3600) return { cadence: { intervalSeconds: Math.round(seconds) } };
  const minutes = Math.round(seconds / 60);
  if (minutes > 1440) {
    return { cadence: { intervalMinutes: 1440 }, note: { code: "cadence-lowered", detail: `${minutes}m → 1440m` } };
  }
  return { cadence: { intervalMinutes: minutes } };
}

/** The largest unit that says a period exactly: 86400 → `1d`, 5400 → `90m`. */
function durationText(seconds: number): string {
  for (const [unit, size] of [["d", 86_400], ["h", 3600], ["m", 60]] as const) {
    if (seconds % size === 0) return `${seconds / size}${unit}`;
  }
  return `${seconds}s`;
}

const HEARTBEAT_MIN_SECONDS = 60;
const HEARTBEAT_MAX_SECONDS = 35 * 86_400;

type Built = { kind: ImportedService["kind"]; service: ServiceInput; validate: () => void; notes: ImportNote[] };

function build(name: string, target: Exclude<Target, { kind: "page" }>, seconds: number | undefined): Built {
  const notes: ImportNote[] = [];
  const cadenced = (): Pick<ServiceInput, "intervalMinutes" | "intervalSeconds"> => {
    const { cadence, note } = probeCadence(seconds);
    if (note !== undefined) notes.push(note);
    return cadence;
  };

  switch (target.kind) {
    case "http": {
      const options: Record<string, string> = {};
      if (target.method !== undefined && target.method !== "GET") options["method"] = target.method;
      if (target.expectStatus !== undefined && target.expectStatus !== "200-299") options["expectStatus"] = target.expectStatus;
      if (target.expectBody !== undefined) options["expectBody"] = target.expectBody;
      if (target.absentBody !== undefined) options["absentBody"] = target.absentBody;
      if (target.slowMs !== undefined) options["slowMs"] = String(target.slowMs);
      if (target.tlsWarnDays !== undefined) options["tlsWarnDays"] = String(target.tlsWarnDays);
      const service = { id: "", name, adapter: "http", baseUrl: target.url, ...cadenced(), options };
      return { kind: "probe", service, notes, validate: () => probeConfig(service) };
    }
    case "tcp": {
      const host = target.host.includes(":") ? `[${target.host}]` : target.host;
      const service = { id: "", name, adapter: "tcp", baseUrl: `http://${host}`, ...cadenced(), options: { port: String(target.port) } };
      return { kind: "probe", service, notes, validate: () => tcpConfig(service) };
    }
    case "dns": {
      const options: Record<string, string> = {};
      if (target.recordType !== "A") options["recordType"] = target.recordType;
      if (target.resolver !== undefined && target.resolver !== "") options["resolver"] = target.resolver;
      if (target.expectValue !== undefined) options["expectValue"] = target.expectValue;
      const service = { id: "", name, adapter: "dns", baseUrl: `https://${target.host}`, ...cadenced(), options };
      return { kind: "probe", service, notes, validate: () => dnsConfig(service) };
    }
    case "heartbeat": {
      let every = Math.round(target.everySeconds);
      if (every < HEARTBEAT_MIN_SECONDS) {
        notes.push({ code: "cadence-raised", detail: `${every}s → 1m` });
        every = HEARTBEAT_MIN_SECONDS;
      } else if (every > HEARTBEAT_MAX_SECONDS) {
        notes.push({ code: "cadence-lowered", detail: `${durationText(every)} → 35d` });
        every = HEARTBEAT_MAX_SECONDS;
      }
      const options: Record<string, string> = { every: durationText(every) };
      if (target.graceSeconds !== undefined && target.graceSeconds > 0) options["grace"] = durationText(target.graceSeconds);
      const service = { id: "", name, adapter: HEARTBEAT_ADAPTER_ID, baseUrl: HEARTBEAT_BASE_URL, options };
      return { kind: "heartbeat", service, notes, validate: () => heartbeatConfig(options) };
    }
  }
}

/**
 * Proposals from candidates: a URL whose host is a catalog entry's status page
 * becomes that provider, read by its proper adapter rather than probed as a web
 * page; everything else becomes the probe or heartbeat it describes.
 */
function propose(tool: ImportTool, candidates: Candidate[], catalog: readonly CatalogEntry[]): ImportResult {
  const byHost = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    const key = hostKey(entry.baseUrl);
    if (key !== undefined && !byHost.has(key)) byHost.set(key, entry);
  }

  const services: ImportedService[] = [];
  const skipped: SkippedMonitor[] = [];
  const taken = new Set<string>();
  const skip = (candidate: Candidate, reason: SkipReason, detail?: string): void => {
    skipped.push({ source: candidate.source, type: candidate.type, reason, ...(detail === undefined ? {} : { detail }) });
  };

  for (const candidate of candidates) {
    if ("skip" in candidate) {
      skip(candidate, candidate.skip, candidate.detail);
      continue;
    }
    const { target } = candidate;
    const group = candidate.group === undefined ? undefined : slugify(candidate.group);
    const common = { ...(candidate.enabled ? {} : { enabled: false }), ...(group === undefined ? {} : { group }) };

    const pageUrl = target.kind === "page" || target.kind === "http" ? target.url : undefined;
    const entry = pageUrl === undefined ? undefined : byHost.get(hostKey(pageUrl) ?? "");
    if (entry !== undefined) {
      if (taken.has(entry.id)) {
        skip(candidate, "duplicate", entry.id);
        continue;
      }
      taken.add(entry.id);
      services.push({
        source: candidate.source,
        type: candidate.type,
        kind: "page",
        service: { id: entry.id, name: entry.name, adapter: entry.adapter, baseUrl: entry.baseUrl, ...common },
        notes: candidate.notes,
      });
      continue;
    }
    if (target.kind === "page") {
      skip(candidate, "page-not-in-catalog", target.url);
      continue;
    }
    if (target.kind === "dns" && !["A", "AAAA", "CNAME", "MX", "NS", "TXT"].includes(target.recordType)) {
      skip(candidate, "unsupported-type", `dns ${target.recordType}`);
      continue;
    }

    const built = build(candidate.source, target, candidate.intervalSeconds);
    let id = slugify(candidate.source);
    for (let n = 2; taken.has(id); n += 1) id = `${slugify(candidate.source).slice(0, 56)}-${n}`;
    const service: ServiceInput = { ...built.service, id, ...common };
    if (Object.keys(service.options ?? {}).length === 0) delete service.options;

    const parsed = serviceDefinitionSchema.safeParse(service);
    if (!parsed.success) {
      skip(candidate, "invalid", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      continue;
    }
    try {
      built.validate();
    } catch (error) {
      skip(candidate, "invalid", error instanceof Error ? error.message : String(error));
      continue;
    }
    taken.add(id);
    services.push({
      source: candidate.source,
      type: candidate.type,
      kind: built.kind,
      service: { ...service, baseUrl: parsed.data.baseUrl },
      notes: [...candidate.notes, ...built.notes],
    });
  }

  return { tool, services, skipped };
}

/**
 * A neighbour's export, read into proposals. `tool` is detected from the file
 * when not given; a file that matches no tool, or not the tool named, throws
 * with a sentence saying so.
 */
export function importMonitors(content: string, catalog: readonly CatalogEntry[], tool?: ImportTool): ImportResult {
  const resolved = tool ?? detectImportTool(content);
  if (resolved === null) {
    throw new Error("this is not an Uptime Kuma backup, a Gatus config.yaml, a Statping export or a StatusGator monitor list");
  }
  let candidates: Candidate[];
  try {
    candidates = PARSERS[resolved](content);
  } catch (error) {
    const reason =
      error instanceof ZodError
        ? error.issues.map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`cannot read this as a ${resolved} export: ${reason}`);
  }
  return propose(resolved, candidates, catalog);
}
