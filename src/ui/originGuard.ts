import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/**
 * Cross-origin write guard: a state-changing request whose `Origin` is not the
 * dashboard's own host, or whose `Host` is not a name the dashboard is meant
 * to be reached under (DNS rebinding), is refused with 403.
 *
 * Defence in depth, not authentication: `API_TOKEN` stays the access control.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Server-to-server callers, which carry no `Origin`. Mirrors `ALWAYS_OPEN` and
 * `OPEN_PREFIXES` in `apiToken.ts` (not exported there): keep them in step.
 */
const OPEN_PATHS = new Set(["/health", "/ready"]);
const OPEN_PREFIXES = ["/push/", "/heartbeat/", "/public"];

export interface OriginRequest {
  method: string;
  path: string;
  origin: string | undefined;
  host: string | undefined;
  allowedHosts: string[];
}

export type OriginVerdict = { allow: true } | { allow: false; message: string };

/** `host:port` or `[::1]:port` down to the bare, lower-cased hostname. */
function hostnameOf(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isTrustedHostname(hostname: string, allowedHosts: string[]): boolean {
  if (hostname === "localhost") return true;
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) return true;
  return allowedHosts.includes(hostname);
}

export function decideOrigin(req: OriginRequest): OriginVerdict {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { allow: true };
  if (OPEN_PATHS.has(req.path) || OPEN_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return { allow: true };
  }
  if (req.origin === undefined || req.origin === "") return { allow: true };

  const host = req.host ?? "";
  let originHost: string;
  try {
    originHost = new URL(req.origin).host;
  } catch {
    return { allow: false, message: "Cross-origin writes are not allowed" };
  }
  if (originHost === "" || originHost.toLowerCase() !== host.toLowerCase()) {
    return { allow: false, message: "Cross-origin writes are not allowed" };
  }
  if (!isTrustedHostname(hostnameOf(host), req.allowedHosts)) {
    return { allow: false, message: "Host not allowed; add it to ALLOWED_HOSTS" };
  }
  return { allow: true };
}

export function readAllowedHosts(env: NodeJS.ProcessEnv): string[] {
  return (env["ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

export function originGuard(env: NodeJS.ProcessEnv) {
  const allowedHosts = readAllowedHosts(env);
  return (req: Request, res: Response, next: NextFunction): void => {
    const verdict = decideOrigin({
      method: req.method,
      path: req.path,
      origin: req.get("origin"),
      host: req.get("host"),
      allowedHosts,
    });
    if (verdict.allow) return next();
    res.status(403).json({ error: { message: verdict.message } });
  };
}
