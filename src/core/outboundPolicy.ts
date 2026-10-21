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

export interface OutboundPolicy {
  /** Also refuse loopback and private ranges. Link-local is refused regardless. */
  blockPrivate: boolean;
}

/** `OUTBOUND_BLOCK_PRIVATE=true` turns the private-range refusal on; anything else leaves it off. */
export function readOutboundPolicy(env: Record<string, string | undefined>): OutboundPolicy {
  return { blockPrivate: env["OUTBOUND_BLOCK_PRIVATE"]?.trim().toLowerCase() === "true" };
}

export type HostLookup = (host: string) => Promise<string[]>;

const resolveAll: HostLookup = async (host) => (await dnsLookup(host, { all: true })).map((entry) => entry.address);

type AddressClass = "link-local" | "private" | "public";

function classifyV4(octets: number[]): AddressClass {
  const [a, b] = octets as [number, number];
  if (a === 169 && b === 254) return "link-local";
  if (a === 127 || a === 10 || a === 0) return "private";
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

function classifyV6(address: string): AddressClass {
  const g = groupsV6(address);
  const first = g[0] ?? 0;
  if ((first & 0xffc0) === 0xfe80) return "link-local";
  // AWS's IPv6 instance metadata endpoint.
  if (g.join(":") === [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(":")) return "link-local";
  const mapped = g.slice(0, 5).every((group) => group === 0) && g[5] === 0xffff;
  if (mapped) {
    const hi = g[6] ?? 0;
    const lo = g[7] ?? 0;
    return classifyV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  if (g.slice(0, 7).every((group) => group === 0) && (g[7] === 1 || g[7] === 0)) return "private";
  if ((first & 0xfe00) === 0xfc00) return "private";
  return "public";
}

function classify(address: string): AddressClass {
  const family = isIP(address);
  if (family === 4) return classifyV4(address.split(".").map(Number));
  if (family === 6) return classifyV6(address);
  return "public";
}

/**
 * Throws unless `url` may be fetched: http(s) only, never a link-local address
 * (cloud metadata lives there), and — when the policy says so — never a loopback
 * or private one. A name is resolved and every address it answers must pass.
 */
export async function assertTargetAllowed(
  url: string,
  policy: OutboundPolicy,
  lookup: HostLookup = resolveAll,
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`refused: scheme ${parsed.protocol} is not http or https`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) === 0 ? await lookup(host) : [host];
  for (const address of addresses) {
    const kind = classify(address);
    if (kind === "link-local") throw new Error("refused: link-local address");
    if (kind === "private" && policy.blockPrivate) {
      throw new Error("refused: private address (OUTBOUND_BLOCK_PRIVATE is set)");
    }
  }
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
