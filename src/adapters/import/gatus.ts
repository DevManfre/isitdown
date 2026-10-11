import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { splitHostPort, type Candidate, type ImportNote, type Target } from "./candidate.ts";

/**
 * Gatus's `config.yaml` — roadmap 2.4, the inverse of the export at
 * `src/ui/exportNeighbour.ts` (roadmap 17.4).
 *
 * Gatus describes health as conditions, and only some of them have a single
 * honest equivalent here: the status code, a substring of the body, response
 * time, certificate expiry. Those are translated; every other condition is
 * named in a note rather than guessed at, because a probe that silently checks
 * less than the original did reads healthy about the wrong thing.
 */

const endpointSchema = z
  .object({
    name: z.string(),
    group: z.string().nullish(),
    url: z.string().nullish(),
    method: z.string().nullish(),
    interval: z.string().nullish(),
    enabled: z.boolean().nullish(),
    conditions: z.array(z.string()).nullish(),
    headers: z.record(z.unknown()).nullish(),
    body: z.string().nullish(),
    dns: z.object({ "query-name": z.string(), "query-type": z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

const externalSchema = z
  .object({
    name: z.string(),
    group: z.string().nullish(),
    enabled: z.boolean().nullish(),
    heartbeat: z.object({ interval: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const gatusFileSchema = z
  .object({
    endpoints: z.array(endpointSchema).nullish(),
    "external-endpoints": z.array(externalSchema).nullish(),
  })
  .passthrough();

/** A Go duration — `30s`, `5m`, `1h30m` — in seconds, or undefined. */
export function goDurationSeconds(value: string | null | undefined): number | undefined {
  const match = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?$/.exec(value?.trim() ?? "");
  if (match === null || (match[1] ?? match[2] ?? match[3]) === undefined) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** `pat(*text*)` with one literal inside, or undefined for any other pattern. */
function containsPattern(value: string): string | undefined {
  const inner = /^pat\(\*(.+)\*\)$/.exec(value.trim())?.[1];
  return inner === undefined || /[*?]/.test(inner) ? undefined : inner;
}

interface Translated {
  http: Extract<Target, { kind: "http" }>;
  /** `[BODY] == value` with no pattern: a DNS answer, or an HTTP check nothing here can make. */
  bodyEquals: { value: string; condition: string } | undefined;
  dropped: string[];
  slow: boolean;
}

/**
 * Status conditions collected as bounds and exact codes, then written back as
 * one `expectStatus` — the reverse of the export's `statusConditions`.
 */
function translateConditions(conditions: readonly string[], url: string): Translated {
  const http: Extract<Target, { kind: "http" }> = { kind: "http", url };
  const exact: number[] = [];
  let low: number | undefined;
  let high: number | undefined;
  let bodyEquals: Translated["bodyEquals"];
  let slow = false;
  const dropped: string[] = [];

  for (const raw of conditions) {
    const condition = raw.trim();
    const match = /^\[([A-Z_]+)\]\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(condition);
    const [, placeholder, operator, value] = match ?? [];
    if (placeholder === undefined || operator === undefined || value === undefined) {
      dropped.push(condition);
      continue;
    }
    if (placeholder === "STATUS") {
      const number = Number(value);
      const any = /^any\(([\d,\s]+)\)$/.exec(value)?.[1];
      if (operator === "==" && Number.isInteger(number)) exact.push(number);
      else if (operator === "==" && any !== undefined) exact.push(...any.split(",").map((part) => Number(part.trim())));
      else if (operator === ">=" && Number.isInteger(number)) low = number;
      else if (operator === ">" && Number.isInteger(number)) low = number + 1;
      else if (operator === "<=" && Number.isInteger(number)) high = number;
      else if (operator === "<" && Number.isInteger(number)) high = number - 1;
      else dropped.push(condition);
    } else if (placeholder === "BODY") {
      const literal = containsPattern(value);
      if (literal !== undefined && operator === "==") http.expectBody = literal;
      else if (literal !== undefined && operator === "!=") http.absentBody = literal;
      else if (operator === "==" && !/^(pat|any)\(/.test(value)) bodyEquals = { value, condition };
      else dropped.push(condition);
    } else if (placeholder === "RESPONSE_TIME" && (operator === "<" || operator === "<=") && /^\d+$/.test(value)) {
      http.slowMs = Number(value);
      slow = true;
    } else if (placeholder === "CERTIFICATE_EXPIRATION" && (operator === ">" || operator === ">=")) {
      const seconds = goDurationSeconds(value);
      if (seconds === undefined) dropped.push(condition);
      else http.tlsWarnDays = Math.max(1, Math.ceil(seconds / 86_400));
    } else if (
      (placeholder === "CONNECTED" && operator === "==" && value === "true") ||
      (placeholder === "DNS_RCODE" && operator === "==" && value === "NOERROR")
    ) {
      // What a tcp or dns probe already requires to read operational at all.
    } else {
      dropped.push(condition);
    }
  }

  if (exact.length > 0 && low === undefined && high === undefined) {
    http.expectStatus = [...new Set(exact)].join(",");
  } else if (exact.length === 0 && (low !== undefined || high !== undefined)) {
    http.expectStatus = `${low ?? 100}-${high ?? 599}`;
  } else if (exact.length > 0) {
    dropped.push(...conditions.filter((condition) => condition.trim().startsWith("[STATUS]")));
  }
  return { http, bodyEquals, dropped, slow };
}

export function parseGatus(content: string): Candidate[] {
  const file = gatusFileSchema.parse(parseYaml(content) ?? {});
  const candidates: Candidate[] = [];

  for (const endpoint of file.endpoints ?? []) {
    const url = endpoint.url?.trim() ?? "";
    const scheme = /^([a-z]+):\/\//i.exec(url)?.[1]?.toLowerCase();
    const base = {
      source: endpoint.name,
      type: endpoint.dns === null || endpoint.dns === undefined ? (scheme ?? "http") : "dns",
      group: endpoint.group ?? undefined,
      enabled: endpoint.enabled ?? true,
      intervalSeconds: goDurationSeconds(endpoint.interval) ?? 60,
      notes: [] as ImportNote[],
    };
    const translated = translateConditions(endpoint.conditions ?? [], url);
    const isDns = endpoint.dns !== null && endpoint.dns !== undefined;
    const dropped = [
      ...translated.dropped,
      ...(isDns || translated.bodyEquals === undefined ? [] : [translated.bodyEquals.condition]),
    ];
    if (dropped.length > 0) base.notes.push({ code: "conditions-dropped", detail: dropped.join("; ") });

    if (endpoint.dns !== null && endpoint.dns !== undefined) {
      const expectValue = translated.bodyEquals?.value ?? translated.http.expectBody;
      candidates.push({
        ...base,
        target: {
          kind: "dns",
          host: endpoint.dns["query-name"],
          recordType: (endpoint.dns["query-type"] ?? "A").toUpperCase(),
          resolver: url.replace(/^[a-z]+:\/\//i, ""),
          ...(expectValue === undefined ? {} : { expectValue }),
        },
      });
      continue;
    }

    if (scheme === "http" || scheme === "https") {
      const method = (endpoint.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        candidates.push({ ...base, skip: "unsupported-method", detail: method });
        continue;
      }
      if (Object.keys(endpoint.headers ?? {}).length > 0 || (endpoint.body ?? "").trim() !== "") {
        base.notes.push({ code: "credentials-dropped" });
      }
      if (translated.slow) base.notes.push({ code: "slow-is-degraded" });
      candidates.push({ ...base, target: { ...translated.http, method } });
      continue;
    }

    if (scheme === "tcp") {
      const { host, port } = splitHostPort(url.slice("tcp://".length));
      if (port === undefined) candidates.push({ ...base, skip: "invalid", detail: "tcp url names no port" });
      else candidates.push({ ...base, target: { kind: "tcp", host, port } });
      continue;
    }

    candidates.push({ ...base, skip: "unsupported-type", detail: scheme ?? url });
  }

  for (const external of file["external-endpoints"] ?? []) {
    const base = {
      source: external.name,
      type: "external",
      group: external.group ?? undefined,
      enabled: external.enabled ?? true,
      notes: [] as ImportNote[],
    };
    const every = goDurationSeconds(external.heartbeat?.interval);
    candidates.push(
      every === undefined || every === 0
        ? { ...base, skip: "no-interval" }
        : { ...base, target: { kind: "heartbeat", everySeconds: every } },
    );
  }

  return candidates;
}
