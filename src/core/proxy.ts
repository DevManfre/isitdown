import http from "node:http";
import type { Logger } from "./logger.ts";

/**
 * Corporate proxies — roadmap 10.7.
 *
 * A network where the only way out is an HTTP proxy is a network where
 * IsItDown read nothing: Node's `fetch` ignores `HTTP_PROXY` unless told
 * otherwise. It is told here, once, by each edition's entrypoint, and from then
 * on every request the process makes honours the three variables — status
 * pages, notifiers, update check, catalog, heartbeat — because they all end up
 * in the same global dispatcher. That is the reason it is a process switch
 * rather than an option on `src/core/http.ts`: the helper is not the only
 * caller of `fetch`, and a proxy that some requests ignore is a bug report
 * that reads "Slack works, Telegram does not".
 *
 * Node's own support, no dependency: `HTTP_PROXY`, `HTTPS_PROXY` and
 * `NO_PROXY`, upper or lower case, credentials in the proxy URL included.
 * TCP, ICMP and DNS probes are not HTTP and never go through it.
 */

const PROXY_VARS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"] as const;

let active = false;

/**
 * Whether this process is sending its requests through a proxy right now —
 * what the egress policy asks, rather than re-reading the environment, so the
 * two can never disagree.
 */
export function proxyActive(): boolean {
  return active;
}

/** True when any proxy variable is set, in either case. */
export function proxyConfigured(env: Record<string, string | undefined>): boolean {
  return PROXY_VARS.some((name) => (env[name]?.trim() ?? "") !== "");
}

/** `http://user:secret@proxy:3128` → `http://proxy:3128`: the log never carries the credential. */
function redact(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "(not a URL)";
  }
}

/**
 * Routes every HTTP request this process makes through the proxy the
 * environment names, and says so in the log. Does nothing — not even a log
 * line — when no proxy variable is set, so a direct installation is untouched.
 * Returns what puts the process back as it was: the entrypoints never need it,
 * a test does.
 */
export function useEnvProxy(env: Record<string, string | undefined>, logger: Logger): () => void {
  if (!proxyConfigured(env)) return () => undefined;
  const reset = http.setGlobalProxyFromEnv(env);
  active = true;
  const pick = (upper: string): string | undefined => {
    const value = env[upper] ?? env[upper.toLowerCase()];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };
  const httpProxy = pick("HTTP_PROXY");
  const httpsProxy = pick("HTTPS_PROXY");
  logger.info("requests go through an HTTP proxy", {
    ...(httpProxy === undefined ? {} : { http: redact(httpProxy) }),
    ...(httpsProxy === undefined ? {} : { https: redact(httpsProxy) }),
    noProxy: pick("NO_PROXY") ?? "",
  });
  return () => {
    reset();
    active = false;
  };
}
