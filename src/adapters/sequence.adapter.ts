import type { Adapter, FetchContext, ReadingNote, ServiceRef } from "../core/adapter.interface.ts";
import { USER_AGENT } from "../core/http.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";
import { failureReason, parseStatusSpec, resolveEnv } from "./http.adapter.ts";

/**
 * The transactional probe — roadmap 2.14: two or three HTTP requests in a row,
 * with a value lifted out of one answer and carried into the next. A login that
 * returns a token, then a call that needs it; a form page that hands out a CSRF
 * value, then the post that wants it back.
 *
 * It is not a browser and does not try to be. No scripting, no rendering, no
 * JavaScript: a request, a rule for pulling one string out of the answer, and
 * the next request. That is enough for an API behind authentication, which is
 * the case the plain `http` probe cannot reach, and it stays inside the
 * project's principle of no dependencies.
 *
 * It inherits the probe's inverted contract (see `http.adapter.ts`): what the
 * target does never throws, it resolves into a severity, and only the
 * operator's own configuration throws. A step that answers 401 or an answer
 * that does not contain the value we were told to find is the service being
 * down, which is the entire reason the check exists.
 *
 * Options are the same flat string map every adapter has, so a step is a group
 * of keys: `step1.method`, `step1.path`, `step1.body`, `step1.header.<Name>`,
 * `step1.extract`, `step1.expectStatus`. Steps are numbered from 1, contiguous,
 * and the last one is the verdict — the step `expectBody`, `absentBody` and
 * `slowMs` apply to. An earlier step only has to succeed.
 *
 * Three honest limits, each deliberate:
 *
 * - a step that carries a `POST` is a request that changes something. A
 *   monitoring tool repeating a login every ten seconds is fine; repeating
 *   "place an order" is not, which is why the poller never retries a probe on
 *   its own and why the form says so beside the method;
 * - extracted values never reach a note, a log line or the dashboard. They are
 *   credentials as often as not, and a reading's explanation is stored;
 * - cookies set by one step ride the next, nothing more: no expiry, no domain
 *   matching. The sequence is one host and a few seconds long.
 */

/** Only these: a probe that DELETEs or PUTs on a timer is a footgun, not a feature. */
const METHODS = ["GET", "HEAD", "POST"] as const;
type StepMethod = (typeof METHODS)[number];

const MIN_STEPS = 2;
const MAX_STEPS = 3;

/** A value pulled out of an answer; this long is a credential, not a hiccup. */
const MAX_VALUE_LENGTH = 8192;

/** Where a named value is read from in a step's answer. */
export type Extractor =
  | { kind: "json"; path: string[] }
  | { kind: "header"; name: string }
  | { kind: "regex"; pattern: RegExp };

export interface Extraction {
  name: string;
  from: Extractor;
  /** The rule as the operator wrote it, for a note — never the value it found. */
  rule: string;
}

export interface Step {
  /** 1-based, as the operator numbers them. */
  index: number;
  method: StepMethod;
  /** The path as written, `{{vars}}` and all. */
  path: string;
  body?: string | undefined;
  headers: Record<string, string>;
  extract: Extraction[];
  accepted: [number, number][];
}

export interface SequenceConfig {
  steps: Step[];
  followRedirects: boolean;
  expectBody?: string | undefined;
  absentBody?: string | undefined;
  slowMs?: number | undefined;
}

/** The option keys this adapter reads, for the settings form and the docs. */
export const SEQUENCE_STEP_KEYS = ["method", "path", "body", "extract", "expectStatus"] as const;
export const SEQUENCE_OPTION_KEYS = ["expectBody", "absentBody", "slowMs", "followRedirects"] as const;
export const SEQUENCE_HEADER_PREFIX = "header.";

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

const fail = (service: ServiceRef, message: string): Error => new Error(`sequence probe for ${service.id}: ${message}`);

/** `a.b.0.c` → ["a","b","0","c"]. */
const jsonPath = (raw: string): string[] => raw.split(".").filter((part) => part !== "");

/**
 * One `name=rule` line. Rules: `json:data.token`, `header:X-Csrf`,
 * `regex:name="csrf" value="([^"]+)"` — the regex's first group is the value,
 * or the whole match when it has none.
 */
function parseExtraction(line: string, service: ServiceRef, step: number): Extraction {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(json|header|regex):(.+)$/s.exec(line);
  if (match === null) {
    throw fail(service, `step${step}.extract line "${line}" is not name=json:path, name=header:Name or name=regex:pattern`);
  }
  const [, name, kind, rest] = match as unknown as [string, string, string, string];
  const rule = `${kind}:${rest.trim()}`;
  if (kind === "json") {
    const path = jsonPath(rest.trim());
    if (path.length === 0) throw fail(service, `step${step}.extract "${name}" has an empty json path`);
    return { name, from: { kind: "json", path }, rule };
  }
  if (kind === "header") return { name, from: { kind: "header", name: rest.trim().toLowerCase() }, rule };
  try {
    return { name, from: { kind: "regex", pattern: new RegExp(rest.trim()) }, rule };
  } catch {
    throw fail(service, `step${step}.extract "${name}" has a regex that does not compile`);
  }
}

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The `{{names}}` a string asks for. */
const variablesIn = (text: string | undefined): string[] =>
  text === undefined ? [] : [...text.matchAll(VARIABLE)].map((match) => match[1] as string);

/**
 * The configuration to probe with, or a thrown error naming the option that is
 * wrong. Exported for the same reason `probeConfig` is: the option surface can
 * be exercised without a socket, and the dashboard can validate a definition
 * before saving it.
 */
export function sequenceConfig(service: ServiceRef): SequenceConfig {
  const options = service.options ?? {};

  const numbered = new Set<number>();
  for (const key of Object.keys(options)) {
    const match = /^step(\d+)\./.exec(key);
    if (match !== null) numbered.add(Number(match[1]));
  }
  const count = numbered.size === 0 ? 0 : Math.max(...numbered);
  if (count < MIN_STEPS) throw fail(service, `needs at least ${MIN_STEPS} steps (step1.path, step2.path, …)`);
  if (count > MAX_STEPS) throw fail(service, `takes at most ${MAX_STEPS} steps; this one has ${count}`);
  for (let index = 1; index <= count; index += 1) {
    if (!numbered.has(index)) throw fail(service, `step${index} is missing: steps are numbered from 1 with no gap`);
  }

  const steps: Step[] = [];
  const known = new Set<string>();
  for (let index = 1; index <= count; index += 1) {
    const prefix = `step${index}.`;
    const method = (trimmed(options[`${prefix}method`]) ?? "GET").toUpperCase();
    if (!METHODS.includes(method as StepMethod)) {
      throw fail(service, `${prefix}method ${method} is not one of ${METHODS.join(", ")}`);
    }
    const body = options[`${prefix}body`];
    if (trimmed(body) !== undefined && method !== "POST") {
      throw fail(service, `${prefix}body needs ${prefix}method POST`);
    }

    const path = options[`${prefix}path`]?.trim() ?? "";
    const headers: Record<string, string> = { accept: "*/*", "user-agent": USER_AGENT };
    for (const [key, value] of Object.entries(options)) {
      if (!key.startsWith(`${prefix}${SEQUENCE_HEADER_PREFIX}`)) continue;
      const name = key.slice(prefix.length + SEQUENCE_HEADER_PREFIX.length).trim();
      if (name === "") throw fail(service, `option "${key}" has no header name`);
      for (const existing of Object.keys(headers)) {
        if (existing !== name && existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
      }
      headers[name] = value;
    }

    // A variable has to exist before the step that spends it: a typo here
    // would otherwise send the literal `{{toekn}}` as a bearer token and the
    // service would, rightly, answer 401.
    for (const name of [...variablesIn(path), ...variablesIn(body), ...Object.values(headers).flatMap(variablesIn)]) {
      if (!known.has(name)) throw fail(service, `${prefix.slice(0, -1)} uses {{${name}}}, which no earlier step extracts`);
    }

    const extract = (trimmed(options[`${prefix}extract`]) ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => parseExtraction(line, service, index));
    for (const extraction of extract) known.add(extraction.name);
    if (index === count && extract.length > 0) {
      throw fail(service, `${prefix}extract is on the last step, which has no later step to use it`);
    }

    steps.push({
      index,
      method: method as StepMethod,
      path,
      body: trimmed(body) === undefined ? undefined : body,
      headers,
      extract,
      accepted: parseStatusSpec(trimmed(options[`${prefix}expectStatus`]) ?? "200-299", service),
    });
  }

  const slow = trimmed(options["slowMs"]);
  if (slow !== undefined && (!Number.isInteger(Number(slow)) || Number(slow) <= 0)) {
    throw fail(service, "slowMs must be a positive whole number of milliseconds");
  }
  const follow = trimmed(options["followRedirects"])?.toLowerCase();
  if (follow !== undefined && !["yes", "true", "1", "on", "no", "false", "0", "off"].includes(follow)) {
    throw fail(service, `followRedirects must be yes or no, not "${follow}"`);
  }

  return {
    steps,
    followRedirects: follow === undefined || ["yes", "true", "1", "on"].includes(follow),
    expectBody: trimmed(options["expectBody"]),
    absentBody: trimmed(options["absentBody"]),
    slowMs: slow === undefined ? undefined : Number(slow),
  };
}

/** What the whole sequence amounted to. */
export type SequenceOutcome =
  | { ok: true; latencyMs: number; lastStatus: number }
  | {
      ok: false;
      /** 1-based step the sequence stopped at. */
      step: number;
      /** What went wrong at it, with no extracted value in it. */
      reason: string;
      /** Whether the target never answered at all, as opposed to answering wrongly. */
      unreachable: boolean;
    };

/** Pure: the severity a finished sequence reads as. */
export function severityFromOutcome(outcome: SequenceOutcome, config: SequenceConfig): OverallStatus {
  if (!outcome.ok) return "major_outage";
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) return "degraded";
  return "operational";
}

export function noteFromOutcome(outcome: SequenceOutcome, config: SequenceConfig): ReadingNote | null {
  if (!outcome.ok) {
    return { text: `step ${outcome.step} of ${config.steps.length}: ${outcome.reason}`, unreachable: outcome.unreachable };
  }
  if (config.slowMs !== undefined && outcome.latencyMs >= config.slowMs) {
    return { text: `the sequence took ${outcome.latencyMs} ms, at or over the ${config.slowMs} ms threshold` };
  }
  return null;
}

/** `{{name}}` → its value; a name with no value is a bug in `sequenceConfig`, so it throws. */
const fill = (text: string, values: Map<string, string>): string =>
  text.replace(VARIABLE, (_match, name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`internal: {{${name}}} had no value`);
    return value;
  });

/** Walks a parsed JSON document along a dotted path; arrays take a numeric segment. */
function walk(document: unknown, path: string[]): string | undefined {
  let node: unknown = document;
  for (const segment of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  return undefined;
}

/** The value one rule finds in an answer, or undefined when it is not there. */
export function extractValue(from: Extractor, headers: Headers, body: string): string | undefined {
  let found: string | undefined;
  if (from.kind === "header") {
    found = headers.get(from.name) ?? undefined;
  } else if (from.kind === "json") {
    try {
      found = walk(JSON.parse(body), from.path);
    } catch {
      found = undefined;
    }
  } else {
    const match = from.pattern.exec(body);
    found = match === null ? undefined : (match[1] ?? match[0]);
  }
  return found === undefined || found === "" || found.length > MAX_VALUE_LENGTH ? undefined : found;
}

const describeRanges = (ranges: [number, number][]): string =>
  ranges.map(([from, to]) => (from === to ? String(from) : `${from}-${to}`)).join(", ");

/** `name=value` pairs of every Set-Cookie an answer carries. */
const cookiesFrom = (headers: Headers): [string, string][] =>
  headers
    .getSetCookie()
    .map((line): [string, string] | null => {
      const pair = line.split(";")[0] ?? "";
      const at = pair.indexOf("=");
      return at < 1 ? null : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    })
    .filter((pair): pair is [string, string] => pair !== null);

/**
 * Runs the steps. Never rejects on the target's behaviour — a refusal, a
 * timeout, a wrong status or a missing value is an outcome — but does throw
 * when an `${ENV}` reference has nothing behind it, which is ours to fix.
 */
export async function runSequence(service: ServiceRef, config: SequenceConfig, timeoutMs: number): Promise<SequenceOutcome> {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  const values = new Map<string, string>();
  const cookies = new Map<string, string>();
  let lastStatus = 0;

  for (const step of config.steps) {
    const last = step.index === config.steps.length;
    const prefix = `step${step.index}.`;

    const path = resolveEnv(fill(step.path, values), service, `${prefix}path`);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(step.headers)) {
      headers[name] = resolveEnv(fill(value, values), service, `${prefix}header.${name}`);
    }
    if (cookies.size > 0 && !Object.keys(headers).some((name) => name.toLowerCase() === "cookie")) {
      headers["cookie"] = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    let body: string | undefined;
    if (step.body !== undefined) {
      body = resolveEnv(fill(step.body, values), service, `${prefix}body`);
      if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
        headers["content-type"] = /^\s*[{[]/.test(body) ? "application/json" : "application/x-www-form-urlencoded";
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, step: step.index, reason: "timed out before it started", unreachable: true };

    let response: Response;
    try {
      response = await fetch(`${service.baseUrl}${path}`, {
        method: step.method,
        headers,
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
        redirect: config.followRedirects ? "follow" : "manual",
        signal: AbortSignal.timeout(remaining),
      });
    } catch (error) {
      return { ok: false, step: step.index, reason: `no answer from ${service.baseUrl}${step.path}: ${failureReason(error)}`, unreachable: true };
    }
    lastStatus = response.status;

    const accepted = step.accepted.some(([from, to]) => response.status >= from && response.status <= to);
    const needsBody = step.extract.length > 0 || (last && (config.expectBody !== undefined || config.absentBody !== undefined));
    let text = "";
    if (needsBody) {
      try {
        text = await response.text();
      } catch {
        text = "";
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }

    if (!accepted) {
      return {
        ok: false,
        step: step.index,
        reason: `answered HTTP ${response.status}, outside the accepted ${describeRanges(step.accepted)}`,
        unreachable: false,
      };
    }

    for (const [name, value] of cookiesFrom(response.headers)) cookies.set(name, value);

    for (const extraction of step.extract) {
      const value = extractValue(extraction.from, response.headers, text);
      if (value === undefined) {
        return { ok: false, step: step.index, reason: `${extraction.rule} found no value for ${extraction.name}`, unreachable: false };
      }
      values.set(extraction.name, value);
    }

    if (last) {
      if (config.expectBody !== undefined && !text.includes(config.expectBody)) {
        return { ok: false, step: step.index, reason: `answered HTTP ${response.status} without the expected "${config.expectBody}" in the body`, unreachable: false };
      }
      if (config.absentBody !== undefined && text.includes(config.absentBody)) {
        return { ok: false, step: step.index, reason: `answered HTTP ${response.status} carrying the forbidden "${config.absentBody}" in the body`, unreachable: false };
      }
    }
  }

  return { ok: true, latencyMs: Date.now() - startedAt, lastStatus };
}

export const sequenceAdapter: Adapter = {
  id: "sequence",
  version: 1,
  kind: "probe",

  validateOptions(options) {
    try {
      sequenceConfig({ id: "sequence", name: "sequence", baseUrl: "http://localhost", options });
      return [];
    } catch (error) {
      return [error instanceof Error ? error.message.replace(/^sequence probe for sequence: /, "") : String(error)];
    }
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = sequenceConfig(service);
    const outcome = await runSequence(service, config, ctx.timeoutMs);

    // The whole sequence's duration is the one latency worth recording, and only
    // when it ran to the end: a sequence cut short measured nothing.
    if (outcome.ok) ctx.onRead?.({ latencyMs: outcome.latencyMs, notModified: false });

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
