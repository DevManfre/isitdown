import { BlockList, isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/**
 * The reverse proxy this instance trusts — roadmap 9.3.
 *
 * Many installations already sit behind a proxy that authenticates (Authelia,
 * Authentik, Tailscale Serve) and says who the user is in a request header.
 * IsItDown takes that name for the configuration history's actor and for the
 * annotations the dashboard creates, without managing an identity of its own:
 * no users, no roles, still one operator (README non-goal).
 *
 * A header is something any client can write, so it is believed only when the
 * connection itself comes from an address in `TRUSTED_PROXY`. From anywhere
 * else it is ignored *and removed* from the request, so nothing downstream can
 * read it by mistake. The same list decides when `X-Forwarded-For` may be read
 * at all (`clientAddress`): the rate limiting of roadmap 9.9 and the local
 * bypass of the API token both need the real client, not the proxy.
 *
 * `TRUSTED_PROXY` unset means no proxy is trusted — every identity header is
 * dropped and the socket's own address is the client, exactly as before.
 */

/** Authelia's and Authentik's header; Tailscale Serve sets `Tailscale-User-Login`. */
export const DEFAULT_IDENTITY_HEADER = "Remote-User";

/** Longest identity kept: a name or an e-mail address, never a paragraph. */
const MAX_IDENTITY_LENGTH = 120;

export interface ProxyTrust {
  /** Whether a request arriving from this address may speak for someone else. */
  trusts(address: string | undefined): boolean;
  /** Lower-cased, as Node keys `req.headers`. */
  identityHeader: string;
}

export interface ProxyTrustReading {
  trust: ProxyTrust;
  /** Entries of `TRUSTED_PROXY` that are neither an address nor a range — left out, never trusted. */
  unusable: string[];
  /** Set when the deprecated `AUDIT_ACTOR_HEADER` was the one that named the header. */
  deprecatedHeader: boolean;
}

/** `::ffff:10.0.0.5` as `10.0.0.5`, so a v4 range matches either spelling Node reports. */
function plain(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped?.[1] ?? address;
}

function addEntry(list: BlockList, entry: string): boolean {
  const [rawAddress = "", bits, extra] = entry.replace(/^\[|\](?=\/|$)/g, "").split("/");
  if (extra !== undefined) return false;
  const address = plain(rawAddress);
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  const width = family === 4 ? 32 : 128;
  if (bits === undefined) {
    list.addAddress(address, type);
    return true;
  }
  if (!/^\d+$/.test(bits) || Number(bits) > width) return false;
  list.addSubnet(address, Number(bits), type);
  return true;
}

/**
 * `TRUSTED_PROXY` (addresses and CIDR ranges, commas or spaces) and
 * `IDENTITY_HEADER`. An unusable entry is reported and left out rather than
 * thrown on: the failure it causes is the safe one — that address is simply not
 * trusted, and the actor reads `local`.
 */
export function readProxyTrust(env: Record<string, string | undefined>): ProxyTrustReading {
  const list = new BlockList();
  const unusable: string[] = [];
  let any = false;
  for (const entry of (env["TRUSTED_PROXY"] ?? "").split(/[\s,]+/).filter((e) => e !== "")) {
    if (addEntry(list, entry)) any = true;
    else unusable.push(entry);
  }

  const named = env["IDENTITY_HEADER"]?.trim() || undefined;
  const legacy = env["AUDIT_ACTOR_HEADER"]?.trim() || undefined;
  const header = (named ?? legacy ?? DEFAULT_IDENTITY_HEADER).toLowerCase();

  return {
    trust: {
      identityHeader: header,
      trusts(address) {
        if (!any || address === undefined || address === "") return false;
        const bare = plain(address);
        const family = isIP(bare);
        if (family === 0) return false;
        return list.check(bare, family === 4 ? "ipv4" : "ipv6");
      },
    },
    unusable,
    deprecatedHeader: named === undefined && legacy !== undefined,
  };
}

/**
 * The address of the client itself. The socket's peer, unless that peer is a
 * trusted proxy: then `X-Forwarded-For` is walked from the right — each hop
 * appends the address it received from — skipping the trusted proxies, and the
 * first address none of them vouches for is the client. A client that writes
 * its own `X-Forwarded-For: 127.0.0.1` only adds an entry to the *left* of the
 * one its proxy appends, so it never gets read.
 */
export function clientAddress(req: Request, trust: ProxyTrust): string | undefined {
  const peer = req.socket.remoteAddress;
  if (!trust.trusts(peer)) return peer;
  const hops = (req.headers["x-forwarded-for"] ?? "")
    .toString()
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    // Something that is not an address is not trusted either: returned as
    // is, it reads as a remote client, which is the safe reading.
    const hop = hops[index] as string;
    if (!trust.trusts(hop)) return hop;
  }
  // Every hop is a trusted proxy (or there were none): the leftmost is as far
  // back as anybody trustworthy saw.
  return hops[0] ?? peer;
}

/**
 * The identity the proxy asserts, cleaned: control characters dropped by code
 * point (a header value can carry any byte the proxy let through, and none of
 * them belongs in a log line or a list), trimmed, bounded.
 */
function cleanIdentity(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = [...raw]
    .filter((char) => (char.codePointAt(0) ?? 0) > 0x1f && char.codePointAt(0) !== 0x7f)
    .join("")
    .trim()
    .slice(0, MAX_IDENTITY_LENGTH);
  return clean === "" ? undefined : clean;
}

/**
 * Middleware, mounted first. Puts the asserted identity in `res.locals.identity`
 * when the request comes from a trusted proxy; otherwise deletes the header so
 * no route can mistake a client's claim for the proxy's.
 */
export function proxyIdentity(trust: ProxyTrust) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = trust.identityHeader;
    if (trust.trusts(req.socket.remoteAddress)) {
      const identity = cleanIdentity(req.headers[header]);
      if (identity !== undefined) res.locals["identity"] = identity;
    } else {
      delete req.headers[header];
    }
    next();
  };
}

/** Who made this request, as the trusted proxy said; undefined when nobody did. */
export function identityOf(res: Response): string | undefined {
  const identity: unknown = res.locals["identity"];
  return typeof identity === "string" ? identity : undefined;
}
