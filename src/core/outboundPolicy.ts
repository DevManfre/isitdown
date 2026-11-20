import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * What the process may fetch on an operator's behalf, and how much of the answer
 * it will keep.
 *
 * Status pages and probe targets are small; 8 MiB is generous for either, and
 * low enough that an endpoint streaming forever cannot exhaust memory.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MAX_REDIRECTS = 5;

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`response exceeded ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Reads a body, refusing one that declares or turns out to exceed `maxBytes`. */
export async function readCapped(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(maxBytes);
  }
  if (response.body === null) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * What happens to a loopback or private-range target (RFC 1918, ULA, CGNAT,
 * `0.0.0.0`). Link-local is refused in every mode — cloud metadata lives there.
 *
 * - `allow`: read it, say nothing. A library default only: tests and tools
 *   that point at a server on 127.0.0.1 run under it.
 * - `warn`: read it, and log once per host that the UI edition would refuse it.
 *   The Light edition's default, for a homelab watching its own LAN.
 * - `deny`: refuse it unless `EGRESS_ALLOW` lists it. The UI edition's default:
 *   anyone who can add a provider there could otherwise read internal services.
 */
export type PrivateTargets = "allow" | "warn" | "deny";

export interface OutboundPolicy {
  privateTargets: PrivateTargets;
  /** `EGRESS_ALLOW` plus `egress.allow`: addresses, CIDR ranges and host names let through. */
  allow: readonly string[];
}

type Warn = (message: string, fields: Record<string, unknown>) => void;

interface EditionDefaults {
  privateTargets: PrivateTargets;
  allow: readonly string[];
  warn: Warn | undefined;
}

let defaults: EditionDefaults = { privateTargets: "allow", allow: [], warn: undefined };
const warned = new Set<string>();

/**
 * Called once by an edition entrypoint (and by the Light config loader for its
 * `egress.allow` list), so `src/core` never has to know which edition it runs in.
 */
export function configureOutbound(next: Partial<EditionDefaults>): void {
  defaults = { ...defaults, ...next };
  warned.clear();
}

/** Test seam: back to the library default. */
export function resetOutbound(): void {
  configureOutbound({ privateTargets: "allow", allow: [], warn: undefined });
}

/**
 * The policy in force: the edition's mode, made `deny` by
 * `OUTBOUND_BLOCK_PRIVATE=true`, with `EGRESS_ALLOW` added to the allowlist.
 */
export function readOutboundPolicy(env: Record<string, string | undefined>): OutboundPolicy {
  const block = env["OUTBOUND_BLOCK_PRIVATE"]?.trim().toLowerCase() === "true";
  return {
    privateTargets: block ? "deny" : defaults.privateTargets,
    allow: [...defaults.allow, ...parseAllowList(env["EGRESS_ALLOW"])],
  };
}

/** `10.0.0.0/8, nas.lan  192.168.1.5` → its entries; commas and spaces both separate. */
export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

/** The entries of a list no rule can use — neither an address, a range nor a host name. */
export function unusableAllowEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => parseRange(entry) === null && !isHostName(entry));
}

export type HostLookup = (host: string) => Promise<string[]>;

const resolveAll: HostLookup = async (host) => (await dnsLookup(host, { all: true })).map((entry) => entry.address);

type AddressClass = "link-local" | "loopback" | "private" | "public";

function classifyV4(octets: number[]): AddressClass {
  const [a, b] = octets as [number, number];
  if (a === 169 && b === 254) return "link-local";
  if (a === 127) return "loopback";
  if (a === 10 || a === 0) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  return "public";
}

/** The eight 16-bit groups of an IPv6 literal, `::` expanded and a dotted tail folded in. */
function groupsV6(address: string): number[] {
  let text = address.split("%")[0] ?? address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted !== null) {
    const [, a, b, c, d] = dotted.map(Number) as [number, number, number, number, number];
    text = text.slice(0, dotted.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((group) => parseInt(group, 16));
}

/** The IPv4 inside an `::ffff:a.b.c.d` address, or null for any other IPv6 one. */
function mappedV4(groups: number[]): number[] | null {
  if (!(groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)) return null;
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function classifyV6(address: string): AddressClass {
  const g = groupsV6(address);
  const first = g[0] ?? 0;
  if ((first & 0xffc0) === 0xfe80) return "link-local";
  // AWS's IPv6 instance metadata endpoint.
  if (g.join(":") === [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(":")) return "link-local";
  const v4 = mappedV4(g);
  if (v4 !== null) return classifyV4(v4);
  if (g.slice(0, 7).every((group) => group === 0) && g[7] === 1) return "loopback";
  if (g.every((group) => group === 0)) return "private";
  if ((first & 0xfe00) === 0xfc00) return "private";
  return "public";
}

function classify(address: string): AddressClass {
  const family = isIP(address);
  if (family === 4) return classifyV4(address.split(".").map(Number));
  if (family === 6) return classifyV6(address);
  return "public";
}

/** An address as a number, IPv4-mapped IPv6 folded to plain IPv4 so either spelling matches. */
function toBits(address: string): { family: 4 | 6; value: bigint } | null {
  const family = isIP(address);
  if (family === 4) {
    return { family: 4, value: address.split(".").reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n) };
  }
  if (family !== 6) return null;
  const groups = groupsV6(address);
  const v4 = mappedV4(groups);
  if (v4 !== null) return { family: 4, value: v4.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n) };
  return { family: 6, value: groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n) };
}

interface Range {
  family: 4 | 6;
  base: bigint;
  prefix: number;
}

/** `10.0.0.0/8`, `fd00::/8` or a bare address (a range of one); null for anything else. */
function parseRange(entry: string): Range | null {
  const [address = "", bits, extra] = entry.replace(/^\[|\](?=\/|$)/g, "").split("/");
  if (extra !== undefined) return null;
  const parsed = toBits(address);
  if (parsed === null) return null;
  const width = parsed.family === 4 ? 32 : 128;
  const prefix = bits === undefined ? width : /^\d+$/.test(bits) ? Number(bits) : NaN;
  if (!(prefix >= 0 && prefix <= width)) return null;
  return { family: parsed.family, base: parsed.value >> BigInt(width - prefix), prefix };
}

function inRange(address: string, range: Range): boolean {
  const parsed = toBits(address);
  if (parsed === null || parsed.family !== range.family) return false;
  const width = parsed.family === 4 ? 32 : 128;
  return parsed.value >> BigInt(width - range.prefix) === range.base;
}

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*\.?$/;

/** A DNS name — and not a mistyped address: a numeric last label (`300.1.1.1`) is no name. */
const isHostName = (entry: string): boolean => HOST_NAME.test(entry) && !/(^|\.)\d+\.?$/.test(entry);

/** The rule a refusal names, so the fix is one copy-paste into the environment. */
const allowHint = (entry: string): string => `add ${entry} to EGRESS_ALLOW`;

export class EgressRefusedError extends Error {
  constructor(message: string) {
    super(`blocked by the egress policy: ${message}`);
    this.name = "EgressRefusedError";
  }
}

export interface HostCheckOptions {
  lookup?: HostLookup | undefined;
  /**
   * A probe passes a name that does not resolve through, so the probe itself
   * reads it as down — "does not resolve" is its answer, not our failure. A
   * status-page read has no such answer to give and refuses it (the default).
   */
  passUnresolved?: boolean | undefined;
}

/**
 * Throws an `EgressRefusedError` unless `host` may be reached. A name is
 * resolved first, and every address it answers must pass: a public-looking
 * name pointed at 10.0.0.5 is a 10.0.0.5 target.
 *
 * A host name on the allowlist lets its private and loopback addresses through,
 * never a link-local one — a name can be re-pointed later, a typed address
 * cannot. An address or range on the list lets through whatever it covers.
 */
export async function assertHostAllowed(
  rawHost: string,
  policy: OutboundPolicy,
  options: HostCheckOptions = {},
): Promise<void> {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  const lookup = options.lookup ?? resolveAll;
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch (error) {
      if (options.passUnresolved === true) return;
      throw error;
    }
  }
  const nameAllowed = isIP(host) === 0 && policy.allow.includes(host.replace(/\.$/, ""));
  const ranges = policy.allow.map(parseRange).filter((range): range is Range => range !== null);

  for (const address of addresses) {
    const kind = classify(address);
    if (kind === "public") continue;
    if (ranges.some((range) => inRange(address, range))) continue;
    const named = host === address ? address : `${host} (${address})`;
    if (kind === "link-local") {
      throw new EgressRefusedError(`${named} is a link-local address, where cloud metadata lives; ${allowHint(address)} if you mean it`);
    }
    if (nameAllowed || policy.privateTargets === "allow") continue;
    if (policy.privateTargets === "warn") {
      if (!warned.has(host)) {
        warned.add(host);
        defaults.warn?.(`reading a ${kind} address; the UI edition refuses it unless EGRESS_ALLOW lists it`, {
          host,
          address,
        });
      }
      continue;
    }
    throw new EgressRefusedError(`${named} is a ${kind} address; ${allowHint(isIP(host) === 0 ? host : address)}`);
  }
}

/**
 * Throws unless `url` may be fetched: http(s) only, and its host must pass
 * `assertHostAllowed`.
 */
export async function assertTargetAllowed(
  url: string,
  policy: OutboundPolicy,
  lookup: HostLookup = resolveAll,
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EgressRefusedError(`scheme ${parsed.protocol} is not http or https`);
  }
  await assertHostAllowed(parsed.hostname, policy, { lookup });
}

/**
 * The check a probe makes before it connects (TCP, ICMP, DNS resolver, IMAP),
 * under the process's policy. A Docker socket is local by definition and never
 * comes through here.
 */
export function assertProbeHost(host: string, lookup?: HostLookup): Promise<void> {
  return assertHostAllowed(host, readOutboundPolicy(process.env), { lookup, passUnresolved: true });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * `fetch` with the target checked first and, when `follow` is set, every
 * redirect hop checked too — `redirect: "follow"` would let a public URL bounce
 * to an address the policy refuses.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  policy: OutboundPolicy,
  follow: boolean,
  lookup?: HostLookup,
): Promise<Response> {
  let current = url;
  let options: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; ; hop++) {
    await assertTargetAllowed(current, policy, lookup);
    const response = await fetch(current, options);
    const location = response.headers.get("location");
    if (!follow || !REDIRECTS.has(response.status) || location === null) return response;
    if (hop >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("too many redirects");
    }
    await response.body?.cancel().catch(() => undefined);
    const next = new URL(location, current);
    const method = (options.method ?? "GET").toUpperCase();
    const toGet = response.status === 303 ? method !== "HEAD" : (response.status === 301 || response.status === 302) && method === "POST";
    const headers = new Headers(options.headers);
    if (new URL(current).origin !== next.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
    }
    options = { ...options, headers };
    if (toGet) {
      const { body: _body, ...rest } = options;
      headers.delete("content-type");
      options = { ...rest, method: "GET" };
    }
    current = next.toString();
  }
}
