import type { RequestHandler } from "express";
import type { Logger } from "../core/logger.ts";

/**
 * Surfaces on their way out — roadmap 16.3. Each one keeps working, warns for
 * one whole major, and goes in the next: deprecated in 2.46, removed in 3.0.
 * `docs/deprecations.md` is the list an operator reads; this is the one the
 * server acts on.
 */
export const REMOVED_IN = "3.0.0";

/** RFC 9745's `Deprecation` value: the moment the deprecation took effect (2026-11-19). */
const DEPRECATED_AT = "@1795046400";

const DOCS = "https://github.com/devmanfre/isitdown/blob/main/docs/deprecations.md";

/**
 * The export twins nothing in the dashboard links to, each with the route a
 * script should read instead.
 */
export const DEPRECATED_EXPORTS: Readonly<Record<string, string>> = {
  "/export/history.json": "/history",
  "/export/trust.csv": "/trust",
  "/export/trust.json": "/trust",
  "/export/sla-evidence.json": "/export/sla-evidence.md",
  "/export/report-card.json": "/export/report-card.md",
};

/**
 * What this process has served that is deprecated, so the usage report can say
 * so. In memory only: it answers "since this start", never more.
 */
export interface DeprecationLedger {
  /** Middleware for one deprecated route: the headers, and a log line the first time. */
  mark(path: string, replacement: string): RequestHandler;
  used(): string[];
}

export function createDeprecationLedger(logger: Logger): DeprecationLedger {
  const used = new Set<string>();
  return {
    mark(path, replacement) {
      return (_req, res, next) => {
        res.setHeader("Deprecation", DEPRECATED_AT);
        res.setHeader("Link", `<${DOCS}>; rel="deprecation"`);
        if (!used.has(path)) {
          used.add(path);
          // Once per path per start: a script polling it every minute must not
          // turn the log into nothing but this line.
          logger.warn("deprecated export served", { path, removedIn: REMOVED_IN, instead: replacement });
        }
        next();
      };
    },
    used: () => [...used].sort(),
  };
}
