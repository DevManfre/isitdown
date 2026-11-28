import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { hashToken, type ApiScope, type ApiTokenStore } from "./dbApiTokens.ts";

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
 * - **It is not authentication.** No identities, no expiry, no users. Since
 *   roadmap 9.11 there can be more than one key — named tokens kept (as hashes)
 *   in the database, each with scopes and each revocable on its own — but a key
 *   still says what it may do, never who holds it.
 *
 * Roadmap 9.11 widened rule 2: a token grants the scopes it was created with
 * (`ROUTE_SCOPES` below says which scope each route needs), and `API_TOKEN`
 * from the environment is a token with `read` alone, exactly what it always
 * was. The gate is on when `API_TOKEN` is set *or* any stored token is still
 * valid — creating the first token is what turns it on.
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
const OPEN_PREFIXES = [
  "/push/",
  /** A cron job's dead-man's-switch ping (roadmap 2.5), same shape and reason as `/push/`. */
  "/heartbeat/",
  /**
   * Also never gated: the public status page (roadmap 5.1). Its whole purpose
   * is to be read by people who are not the operator and who therefore hold no
   * token — gating it would make the feature unusable, and it publishes nothing
   * private by construction (see `publicPage.ts`). It registers no routes at
   * all unless the operator turned it on.
   */
  "/public",
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Which scope each route needs — roadmap 9.11. Every write route the app
 * registers has an explicit entry here (a test walks the app and fails on one
 * that does not), so a new route is a decision about who may call it rather
 * than whatever a default happened to be. A read needs `read` unless it is
 * listed. Paths are written the way the routers write them.
 */
export const ROUTE_SCOPES: readonly { method: string; path: string; scope: ApiScope }[] = [
  // Deploy markers and other notes on the charts: what a CI job writes.
  { method: "POST", path: "/annotations", scope: "annotations:write" },
  { method: "DELETE", path: "/annotations/:id", scope: "annotations:write" },
  // Silencing: what a maintenance script does, and nothing it can break.
  { method: "POST", path: "/providers/:id/mute", scope: "mute" },
  { method: "POST", path: "/providers/:id/ack", scope: "mute" },
  // Asking for a reading now — a deploy pipeline's "check before you go".
  { method: "POST", path: "/poll", scope: "push" },

  // Everything else that writes is the operator's.
  { method: "GET", path: "/config/tokens", scope: "admin" },
  { method: "POST", path: "/config/tokens", scope: "admin" },
  { method: "DELETE", path: "/config/tokens/:id", scope: "admin" },
  { method: "PATCH", path: "/config/ai", scope: "admin" },
  { method: "PUT", path: "/config/ai/:credential", scope: "admin" },
  { method: "DELETE", path: "/config/ai/:credential", scope: "admin" },
  { method: "POST", path: "/incidents/:providerId/:incidentId/summary", scope: "admin" },
  { method: "POST", path: "/config/history/:id/revert", scope: "admin" },
  { method: "PUT", path: "/config/backup/schedule", scope: "admin" },
  { method: "POST", path: "/config/backup/run", scope: "admin" },
  { method: "POST", path: "/config/restore", scope: "admin" },
  { method: "PATCH", path: "/config/channels/:id", scope: "admin" },
  { method: "PUT", path: "/config/channels/:id/secrets", scope: "admin" },
  { method: "DELETE", path: "/config/channels/:id/secrets/:field", scope: "admin" },
  { method: "POST", path: "/config/channels/:id/test", scope: "admin" },
  { method: "PUT", path: "/config/routing", scope: "admin" },
  { method: "PUT", path: "/config/recipients", scope: "admin" },
  { method: "POST", path: "/config/discover", scope: "admin" },
  { method: "POST", path: "/config/import/neighbour", scope: "admin" },
  { method: "POST", path: "/config/import/preview", scope: "admin" },
  { method: "POST", path: "/config/import", scope: "admin" },
  { method: "POST", path: "/config/snapshots", scope: "admin" },
  { method: "POST", path: "/config/snapshots/:id/restore", scope: "admin" },
  { method: "DELETE", path: "/config/snapshots/:id", scope: "admin" },
  { method: "PATCH", path: "/config/settings", scope: "admin" },
  { method: "POST", path: "/debug/adapters/:id/probe", scope: "admin" },
  { method: "PUT", path: "/incidents/:providerId/:incidentId/follow", scope: "admin" },
  { method: "DELETE", path: "/incidents/:providerId/:incidentId/follow", scope: "admin" },
  { method: "POST", path: "/incidents/:providerId/:incidentId/notes", scope: "admin" },
  { method: "DELETE", path: "/incidents/:providerId/:incidentId/notes/:noteId", scope: "admin" },
  { method: "POST", path: "/config/series", scope: "admin" },
  { method: "DELETE", path: "/config/series/:id", scope: "admin" },
  { method: "POST", path: "/config/push/subscriptions", scope: "admin" },
  { method: "DELETE", path: "/config/push/subscriptions/:id", scope: "admin" },
  { method: "PATCH", path: "/api/preferences", scope: "admin" },
  { method: "POST", path: "/dashboards", scope: "admin" },
  { method: "POST", path: "/dashboards/import", scope: "admin" },
  { method: "POST", path: "/dashboards/restore", scope: "admin" },
  { method: "PATCH", path: "/dashboards/:id", scope: "admin" },
  { method: "PUT", path: "/dashboards/:id", scope: "admin" },
  { method: "DELETE", path: "/dashboards/:id", scope: "admin" },
  { method: "DELETE", path: "/dashboards/:id/layout", scope: "admin" },
  { method: "POST", path: "/config/catalog/proposals/:id/dismiss", scope: "admin" },
  { method: "POST", path: "/config/services", scope: "admin" },
  { method: "PATCH", path: "/config/services", scope: "admin" },
  { method: "POST", path: "/config/services/preview-components", scope: "admin" },
  { method: "POST", path: "/config/services/preview-read", scope: "admin" },
  { method: "POST", path: "/config/services/detect", scope: "admin" },
  { method: "PATCH", path: "/config/services/:id", scope: "admin" },
  { method: "DELETE", path: "/config/services/:id", scope: "admin" },
  { method: "POST", path: "/config/services/:id/restore", scope: "admin" },
  { method: "DELETE", path: "/config/services/:id/permanently", scope: "admin" },
  { method: "POST", path: "/config/services/:id/test", scope: "admin" },
  { method: "POST", path: "/config/storage/maintenance", scope: "admin" },
];

const compiled = ROUTE_SCOPES.map((entry) => ({
  ...entry,
  // `:param` matches one segment; nothing else in these paths is special.
  pattern: new RegExp(`^${entry.path.replace(/:[A-Za-z]+/g, "[^/]+")}/?$`),
}));

/**
 * The scope a request needs. A write no entry names — a path no route answers,
 * which will be a 404 — needs `admin`: the safe answer for a gap the coverage
 * test exists to keep from being anything but a 404.
 */
export function requiredScope(method: string, path: string): ApiScope {
  const upper = method.toUpperCase();
  // HEAD and OPTIONS ask what GET would answer.
  const asked = upper === "HEAD" || upper === "OPTIONS" ? "GET" : upper;
  const entry = compiled.find((route) => route.method === asked && route.pattern.test(path));
  if (entry !== undefined) return entry.scope;
  return READ_METHODS.has(asked) ? "read" : "admin";
}

/** Whether a token holding `granted` may do what `needed` names. */
export const grants = (granted: readonly ApiScope[], needed: ApiScope): boolean =>
  granted.includes("admin") || granted.includes(needed);

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

/**
 * Constant-time over the two hashes, which are always the same length: neither
 * the token's content nor its length leaks through how long the answer takes.
 */
function tokenMatches(expected: string, given: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(expected), "hex"), Buffer.from(hashToken(given), "hex"));
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
  | { allow: true; tokenId?: number }
  | { allow: false; status: 401 | 403; message: string };

/**
 * The whole decision, as a function of what the request is rather than of an
 * `express` object: this is the part worth testing exhaustively, and a test
 * that has to build a request to ask "may a token holder POST?" tests the
 * framework instead.
 *
 * `stored` is the database's tokens (roadmap 9.11); absent, only `API_TOKEN`
 * counts, as before. A request a stored token let through carries that token's
 * id back, so the middleware can record the use.
 */
export function decide(input: {
  policy: TokenPolicy;
  path: string;
  method: string;
  presented: string;
  local: boolean;
  stored?: Pick<ApiTokenStore, "anyActive" | "find"> | undefined;
}): Verdict {
  const { policy, path, method, presented, local, stored } = input;
  if (policy.token === "" && !(stored?.anyActive() ?? false)) return { allow: true };
  if (ALWAYS_OPEN.has(path)) return { allow: true };
  if (OPEN_PREFIXES.some((prefix) => path.startsWith(prefix))) return { allow: true };

  if (presented !== "") {
    // `API_TOKEN` is a token with `read` alone — what it always granted.
    const fromEnv = policy.token !== "" && tokenMatches(policy.token, presented);
    const found = fromEnv ? null : (stored?.find(presented) ?? null);
    const granted: readonly ApiScope[] | null = fromEnv ? ["read"] : (found?.scopes ?? null);
    if (granted !== null) {
      const needed = requiredScope(method, path);
      if (grants(granted, needed)) return found === null ? { allow: true } : { allow: true, tokenId: found.id };
      return {
        allow: false,
        status: 403,
        message:
          fromEnv
            ? "this token grants read access only"
            : `this token lacks the ${needed} scope`,
      };
    }
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
 * Whether this request comes from the operator — the dashboard on this
 * machine, or a token holding `admin` — rather than from a narrower token.
 *
 * For a route that answers everybody but may show a secret only to the
 * operator (the provider push URL, roadmap 1.2): asking `decide` an admin-only
 * question keeps one rule for "who is the operator" instead of a second copy
 * that could drift from it.
 */
export function mayWrite(env: NodeJS.ProcessEnv, req: Request, stored?: ApiTokenStore): boolean {
  return decide({
    policy: readTokenPolicy(env),
    path: "/config/tokens",
    method: "POST",
    presented: presentedToken({
      authorization: req.get("authorization"),
      apiToken: req.get("x-api-token"),
    }),
    local: isLocalAddress(req.socket.remoteAddress),
    stored,
  }).allow;
}

/**
 * The middleware. Mounted first, so nothing downstream — not a route, not the
 * static dashboard — can be reached around it.
 */
export function apiToken(env: NodeJS.ProcessEnv, stored?: ApiTokenStore) {
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
      stored,
    });
    if (verdict.allow) {
      if (verdict.tokenId !== undefined) stored?.touch(verdict.tokenId);
      next();
      return;
    }
    // `WWW-Authenticate` on the 401 so a generated client knows what to send
    // back rather than guessing at a login form that does not exist.
    if (verdict.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="isitdown"');
    res.status(verdict.status).json({ error: { message: verdict.message } });
  };
}
