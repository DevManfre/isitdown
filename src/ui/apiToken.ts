import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * A read-only API token — roadmap 4.15.
 *
 * Every route here is open, which is exactly right on `127.0.0.1` and exactly
 * wrong the moment the widget endpoint (roadmap 4.11) or a badge has to be
 * reachable from another host. The smallest thing that unblocks those without
 * turning a single-operator dashboard into user management is one bearer token
 * that grants *read* access and nothing else.
 *
 * The three rules, in the order they are applied:
 *
 * 1. **No `API_TOKEN` set: nothing changes.** This has to be true. An upgrade
 *    that quietly started refusing the operator's own dashboard would be a
 *    monitoring tool that stopped monitoring, and the feature is for the
 *    installations that asked for it.
 * 2. **A request carrying the token is read-only.** `GET` and `HEAD` pass;
 *    anything else is `403`. The token is handed to a home page widget, a
 *    scrape job, a status page — none of which has any business writing, and
 *    all of which will eventually be pasted somewhere it should not have been.
 * 3. **A request without it has to come from this machine.** That is the
 *    deployment the project documents, and it is what keeps the dashboard
 *    itself working with no token while the token is what reaches in from
 *    elsewhere.
 *
 * Two things this deliberately does *not* do:
 *
 * - **It never reads `X-Forwarded-For`.** A header the client writes cannot
 *   decide whether the client is local. The consequence is real and is
 *   documented: a reverse proxy on this same host makes every request it
 *   forwards look local, so an installation behind one sets
 *   `API_LOCAL_BYPASS=false` and requires the token from everybody, loopback
 *   included.
 * - **It is not authentication.** One token, no identities, no expiry, nothing
 *   to revoke but the variable. It is a door with one key, which is what the
 *   roadmap row asked for and all the no-multi-user stance allows.
 *
 * `/health` and `/ready` are always open: a Kubernetes probe arrives from the
 * node's address rather than from loopback, and a liveness check that starts
 * failing because a token was set is a restart loop.
 */

/** Never gated: the container runtime's own two questions. */
const ALWAYS_OPEN = new Set(["/health", "/ready"]);

/**
 * Also never gated: a provider's own webhook (roadmap 2.10). Its caller is
 * Statuspage rather than an operator — it cannot be given a bearer token, and
 * it is a POST, which this token refuses on principle. It carries its own
 * credential in the URL instead, and `push.routes.ts` is where that is checked.
 */
const OPEN_PREFIXES = ["/push/"];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface TokenPolicy {
  /** The token itself. Empty means the whole feature is off. */
  token: string;
  /**
   * Whether a request from this machine may skip the token. True by default —
   * that is the documented deployment — and turned off by an installation that
   * has a reverse proxy in front, where "local" stops meaning anything.
   */
  localBypass: boolean;
}

/**
 * Read from the environment only. A token is a credential, and this project's
 * rule is that credentials come from the environment rather than from the
 * database the dashboard can write.
 */
export function readTokenPolicy(env: NodeJS.ProcessEnv): TokenPolicy {
  return {
    token: (env["API_TOKEN"] ?? "").trim(),
    // Anything but an explicit "false" leaves the bypass on: the failure mode
    // of a typo has to be "the dashboard still works", not "the operator is
    // locked out of their own machine".
    localBypass: (env["API_LOCAL_BYPASS"] ?? "").trim().toLowerCase() !== "false",
  };
}

/**
 * The loopback addresses Node reports, including the IPv4-mapped form an
 * IPv6 socket hands back for a v4 client. An absent address is a unix socket,
 * which is as local as a connection gets.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (address === undefined || address === "") return true;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** Constant-time, and a length mismatch is itself the answer. */
function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The token a request presents, from either header. `Authorization: Bearer` is
 * what a generated client sends; `X-API-Token` is what a home page widget's
 * config file can usually express without a scheme.
 */
export function presentedToken(headers: {
  authorization?: string | undefined;
  apiToken?: string | undefined;
}): string {
  const bearer = /^Bearer\s+(.+)$/i.exec((headers.authorization ?? "").trim());
  if (bearer?.[1] !== undefined) return bearer[1].trim();
  return (headers.apiToken ?? "").trim();
}

export type Verdict =
  | { allow: true }
  | { allow: false; status: 401 | 403; message: string };

/**
 * The whole decision, as a function of what the request is rather than of an
 * `express` object: this is the part worth testing exhaustively, and a test
 * that has to build a request to ask "may a token holder POST?" tests the
 * framework instead.
 */
export function decide(input: {
  policy: TokenPolicy;
  path: string;
  method: string;
  presented: string;
  local: boolean;
}): Verdict {
  const { policy, path, method, presented, local } = input;
  if (policy.token === "") return { allow: true };
  if (ALWAYS_OPEN.has(path)) return { allow: true };
  if (OPEN_PREFIXES.some((prefix) => path.startsWith(prefix))) return { allow: true };

  if (presented !== "" && tokenMatches(policy.token, presented)) {
    if (READ_METHODS.has(method)) return { allow: true };
    return {
      allow: false,
      status: 403,
      message: "this token grants read access only",
    };
  }

  // A wrong token from this machine is still a local request, and local
  // requests are the operator's own: failing them would lock the dashboard out
  // over a stale variable somewhere else.
  if (policy.localBypass && local) return { allow: true };

  return {
    allow: false,
    status: 401,
    message:
      presented === ""
        ? "this instance requires an API token: send it as Authorization: Bearer or X-API-Token"
        : "that API token is not this instance's",
  };
}

/**
 * The middleware. Mounted first, so nothing downstream — not a route, not the
 * static dashboard — can be reached around it.
 */
export function apiToken(env: NodeJS.ProcessEnv) {
  const policy = readTokenPolicy(env);
  return (req: Request, res: Response, next: NextFunction): void => {
    const verdict = decide({
      policy,
      // `req.path` rather than `req.url`: a query string must not be able to
      // make a gated path look like `/health`.
      path: req.path,
      method: req.method,
      presented: presentedToken({
        authorization: req.get("authorization"),
        apiToken: req.get("x-api-token"),
      }),
      local: isLocalAddress(req.socket.remoteAddress),
    });
    if (verdict.allow) {
      next();
      return;
    }
    // `WWW-Authenticate` on the 401 so a generated client knows what to send
    // back rather than guessing at a login form that does not exist.
    if (verdict.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="isitdown"');
    res.status(verdict.status).json({ error: { message: verdict.message } });
  };
}
